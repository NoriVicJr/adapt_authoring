// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Ouput plugin submodule
 */

var path = require('path'),
    _ = require('underscore'),
    fs = require('fs-extra'),
    util = require('util'),
    async = require('async'),
    EventEmitter = require('events').EventEmitter,
    configuration = require('./configuration'),
    assetmanager = require('./assetmanager'),
    filestorage = require('./filestorage'),
    logger = require('./logger'),
    rest = require('./rest'),
    pluginmanager = require('./pluginmanager'),
    database = require('./database'),
    usermanager = require('./usermanager'),
    rimraf = require('rimraf'),
    helpers = require('./helpers'),
    origin = require('../');

/*
 * CONSTANTS
 */
var MODNAME = 'outputmanager';
var WAITFOR = 'pluginmanager';

var Constants = {
    CourseCollections : {
        'course': {
            tag: null,
            filename: 'course.json',
            omitProps: ['customStyle']
        },
        'config': {
            tag: null,
            filename: 'config.json',
            omitProps: ['_theme', '_menu',
              '_enabledExtensions', '_enabledComponents',
            ]
        },
        'contentobject': {
            tag: 'co',
            filename: 'contentObjects.json',
            omitProps: null
        },
        'article': {
            tag: 'a',
            filename: 'articles.json',
            omitProps: null
        },
        'block': {
            tag: 'b',
            filename: 'blocks.json',
            omitProps: null
        },
        'component' : {
            tag: 'c',
            filename: 'components.json',
            omitProps: null
        }
    },
    Defaults: {
        ThemeName : 'adapt-contrib-vanilla',
        MenuName : 'adapt-contrib-boxMenu'
    },
    Folders: {
        Source: 'src',
        Build: 'build',
        Assets: 'assets',
        Exports: 'exports',
        Course: 'course',
        AllCourses: 'courses',
        Theme: 'theme',
        Temp: 'temp',
        Menu: 'menu',
        Less: 'less',
        Framework: 'adapt_framework',
        Plugins: 'plugins'
    },
    Filenames: {
      Download: 'download.zip',
      Main: 'index.html',
      Rebuild: '.rebuild',
      CustomStyle: 'zzzzz.less',
      Variables: 'colors.less',
      Bower: 'bower.json',
      Package: 'package.json',
      Metadata: 'metadata.json'
    },
    Modes: {
      export: 'EXPORT',
      preview: 'PREVIEW',
      publish: 'PUBLISH'
    }
};

/**
 * base constructor for Output plugins
 * @api public
 */
function OutputPlugin () {

}

OutputPlugin.prototype.getCourseJSON = function(tenantId, courseId, next) {
  var self = this;
  var outputJson = {};

  logger.log('info', 'Retrieving JSON');
  database.getDatabase(function(err, db) {
    if (err) {
      logger.log('error', err);
      return err;
    }
    async.each(Object.keys(Constants.CourseCollections), function(collectionType, callback) {
      // Set the courseId correctly
      var criteria = collectionType === 'course' ? { _id: courseId } : { _courseId: courseId };

      if (collectionType === 'config') {
        origin().contentmanager.getContentPlugin('config', function (err, contentPlugin) {
          if (err) {
            return callback(err);
          }
          contentPlugin.retrieve(criteria, {}, function(err, config) {
            if (err) {
              return callback(err);
            }
            if (config.length !== 1) {
              return callback(new Error('Preview/Publish: Unable to retrieve config.json'));
            }
            flattenObject(config[0], '_extensions');
            flattenObject(config[0], 'menuSettings');

            outputJson[collectionType] = config;

            callback(null);
          });
        });
      } else {
        db.retrieve(collectionType, criteria, {operators: { sort: { _sortOrder: 1}}}, function (error, results) {
          if (error) {
            return callback(error);
          }
          if (!results || results.length === 0) {
            outputJson[collectionType] = [];
            callback(null);
          }
          db.exportResults(results, function (transformed) {
            var output = [];
            transformed && transformed.forEach(function (item) {
              flattenObject(item, 'menuSettings');
              // flattenObject(item, 'themeSettings');
              output.push(item);
            });
            outputJson[collectionType] = output;

            callback(null);
          });
        });
      }
    }, function(err) {
      if (err) {
        logger.log('error', err);
        return next(err);
      }
      next(null, outputJson);
    });
  }, tenantId);
};

// Moves any attrubutes on the parentObject[key] to the parent
var flattenObject = function(parentObject, key) {
  if(!parentObject || !parentObject[key]) {
    return;
  }
  Object.keys(parentObject[key]).forEach(function(nestedKey) {
    if(!parentObject[nestedKey]) { // don't override anything
      parentObject[nestedKey] = parentObject[key][nestedKey];
    }
  });
  delete parentObject[key];
};

/**
 * Sanatizes the component
 * @param mode string A string describing the type of output (eg export, publish, preview)
 * @param json Course json
 * @param next callback
 */
OutputPlugin.prototype.sanitizeCourseJSON = function(mode, json, next) {
  // FIXME surely don't need a try around the whole function...
  try {
    var outputJson = json;
    var courseJson = outputJson['course'][0];
    var configJson = outputJson['config'][0];
    var contentObjectJson = outputJson['contentobject'];
    var blockJson = outputJson['block'];
    var componentJson = outputJson['component'];
    var courseId = courseJson._id.toString();
    // The Adapt Framework expects the 'type' and '_id'
    // attributes of the course to be set to 'course'
    courseJson._type = 'course';
    courseJson._id = 'course';
    courseJson._latestTrackingId = blockJson.length;
    // Replace any reference to the original course _id value in contentObjects JSON
    for (var i = 0; i < contentObjectJson.length; i++) {
      if (contentObjectJson[i]._parentId.toString() !== courseId) {
        continue;
      }
      contentObjectJson[i]._parentId = 'course';
    }
    // Add a _trackingId value to every block
    for (var i = 0; i < blockJson.length; i++) {
      blockJson[i]._trackingId = (i + 1);
    }
    // The 'properties' property of a component should not be included as an
    // attribute in the output, but all its children should
    for (var i = 0; i < componentJson.length; i++) {
      if (!componentJson[i].hasOwnProperty('properties')) {
        continue;
      }
      for(var key in componentJson[i].properties){
        if (componentJson[i].properties.hasOwnProperty(key)){
          continue;
        }
        componentJson[i][key] = componentJson[i].properties[key];
      }
      // Remove the 'properties' property
      delete componentJson[i].properties;
    }
    if (mode !== Constants.Modes.export) {
      configJson.build = {
        includes: this.generateIncludesForConfig(configJson)
      };
    }
    // Store the sanitized JSON
    outputJson.course = courseJson;
    outputJson.contentobject = contentObjectJson;
    outputJson.config = configJson;
    outputJson.component = componentJson;

    return next(null, outputJson);
  } catch(err) {
    return next(err);
  }
};

OutputPlugin.prototype.generateIncludesForCourse = function(courseId, next) {
  var self = this;
  async.waterfall([
    function getContentPlugin(callback) {
      origin().contentmanager.getContentPlugin('config', callback);
    },
    function getConfig(contentPlugin, callback) {
      contentPlugin.retrieve({_courseId: courseId}, {}, callback);
    },
    function getIncludes(config, callback) {
      var includes = self.generateIncludesForConfig(config[0]);
      if(!includes) callback(new Error("No plugins included for course " + courseId));
      else callback(null, includes);
    }
  ], next);
};

// Process the 'config' object to hold the plugins
OutputPlugin.prototype.generateIncludesForConfig = function(config) {
  var includedPlugins = [];
  var menu = config.hasOwnProperty('_menu')
    ? config._menu
    : Constants.Defaults.MenuName;
  var theme = config.hasOwnProperty('_theme')
    ? config._theme
    : Constants.Defaults.ThemeName;

  // ensure the theme and menu are compiled
  includedPlugins = [theme, menu];

  // Process the extensions
  if (config.hasOwnProperty('_enabledExtensions')) {
    for (var i in config._enabledExtensions) {
      includedPlugins.push(config._enabledExtensions[i].name);
    }
  }

  // Process the components
  if (config.hasOwnProperty('_enabledComponents')) {
    for (var i in config._enabledComponents) {
      includedPlugins.push(config._enabledComponents[i].name);
    }
  }

  // Fixes #1033 - it looks like a hack but there is no way around this until the dependencies
  // are resolved.
  if (_.indexOf(includedPlugins, 'adapt-contrib-hotgraphic') > -1 && _.indexOf(includedPlugins, 'adapt-contrib-narrative') == -1) {
    includedPlugins.push('adapt-contrib-narrative');
  }

  if (_.indexOf(includedPlugins, 'adapt-contrib-gmcq') > -1 && _.indexOf(includedPlugins, 'adapt-contrib-mcq') == -1) {
    includedPlugins.push('adapt-contrib-mcq');
  }

  return includedPlugins;
};

OutputPlugin.prototype.writeCourseJSON = function(jsonObject, destinationFolder, next) {
  try {
    var outputJson = jsonObject;

    async.each(Object.keys(Constants.CourseCollections), function(collectionType, callback) {
      var propertiesToOmit = Constants.CourseCollections[collectionType].omitProps;

      if (propertiesToOmit) {
        // Remove any non-essential properties from the JSON.
        outputJson[collectionType] = _.omit(outputJson[collectionType], propertiesToOmit);
      }
      var data = JSON.stringify(outputJson[collectionType], undefined, 2);
      var filename = (collectionType === 'config')
        ? path.join(destinationFolder, Constants.CourseCollections[collectionType].filename)
        : path.join(destinationFolder, outputJson['config']._defaultLanguage, Constants.CourseCollections[collectionType].filename);

      fs.outputFile(filename, data, callback);
    }, function(err) {
      if (err) {
        logger.log('error', err);
      }
      return next(err);
    });
  } catch (err) {
    logger.log('error', err);
    next(err);
  }
};

OutputPlugin.prototype.buildFlagExists = function(pathToBuildFlag, next) {
  fs.stat(pathToBuildFlag, function(err, stats) {
    if (err && err.code !== 'ENOENT') {
      logger.log('error', err);
    }
    return next(null, typeof stats == 'object');
  });
};

OutputPlugin.prototype.clearBuildFlag = function(pathToBuildFlag, next) {
  fs.unlink(pathToBuildFlag, function (err) {
    if (err && err.code !== 'ENOENT') {
      // just log error, failing to remove the .rebuild file shouldn't break everything
      logger.log('error', err);
    }
    next();
  });
};

OutputPlugin.prototype.applyTheme = function(tenantId, courseId, jsonObject, destinationFolder, next) {
  var self = this;
  var themeSettings = jsonObject['course'][0].themeSettings;
  var themeName = jsonObject.config[0]._theme || Constants.Defaults.ThemeName;

  if (!themeSettings && !jsonObject['config'][0].customStyle) {
    logger.log('info', 'No theme customisations');
    return next(null, themeName);
  }
  var themeAssetsFolder = path.join(destinationFolder, Constants.Folders.Assets);
  var masterDb;
  var theme;
  var THEME_ROOT;
  var themeFolder;

  database.getDatabase(function (err, masterDb) {
    if (err) {
      return cb(err, 'Unable to connect to database');
    }

    /**
    * Get DB data
    */

    masterDb.retrieve('themetype', { name: themeName }, {}, function(err, results) {
      if (err || (results && results.length !== 1)) {
        return cb(err, 'Unable to retrieve themetype with name ' + themeName);
      }
      theme = results[0];
      THEME_ROOT = path.join(configuration.tempDir, configuration.getConfig('masterTenantID'), Constants.Folders.Framework, Constants.Folders.Source, Constants.Folders.Theme);
      themeFolder = path.join(THEME_ROOT, theme.name);

      /**
      * Copy theme files
      */

      // Remove any current temporary theme folder
      fs.remove(destinationFolder, function(err) {
        if (err) {
          return next(err);
        }
        // Setup the tempoary theme folder
        fs.copy(themeFolder, destinationFolder, function (err) {
          if (err) {
            logger.log('error', err);
            return next(err, 'Error copying ' + themeFolder + ' to ' + destinationFolder);
          }

          /**
          * Apply custom theme settings
          */

          if (!themeSettings) {
            logger.log('info', 'No theme customisations, but custom CSS/LESS');
            // Get the theme name from the destinationFolder
            return next(null, destinationFolder.replace(THEME_ROOT + path.sep,''));
          }
          if(!theme.properties) {
            logger.log('info', 'No theme properties');
            return next(null, themeName);
          }
          // Make subsitutions in variables.less for any customisations
          fs.readdir(path.join(destinationFolder, Constants.Folders.Less), function(error, contents) {
            async.each(contents, function(item, eachCallback) {
              if(item.search(/.+\.less$/) === -1) {
                return eachCallback();
              }

              /**
              * Make LESS subsitutions in file
              */

              fs.readFile(path.join(destinationFolder, Constants.Folders.Less, item), function(err, fileBuff) {
                if (err) {
                  logger.log('error', err);
                  return next(null, themeName);
                }
                file = fileBuff.toString();

                var SEPARATOR = '-';
                var props = [];
                var savedSettings = [];

                // The theme should have defaults defined
                // Get the less variable names that should be replaced
                async.series([
                  function(seriesCallback) {
                    // Flatten the property names to allow two levels
                    // This is in the case where an object has been used to group
                    // theme properties
                    async.eachSeries(_.keys(theme.properties), function(key, innerCallback) {
                      if (!theme.properties[key].hasOwnProperty('properties')) {
                        // Push the property as is
                        props.push(key);
                        return innerCallback();
                      }
                      // There are nested properties to process
                      async.eachSeries(_.keys(theme.properties[key].properties), function(childKey, secondInnerCallback) {
                        props.push(key + SEPARATOR + childKey);
                        theme.properties[key + SEPARATOR + childKey] = theme.properties[key].properties[childKey];
                        secondInnerCallback();
                      }, function(err) {
                        if (!err) {
                          delete theme.properties[key];
                        }
                        innerCallback();
                      });
                    },
                    function(err) {
                      if (err) {
                        logger.log('error', 'Theme customisations 1 of 4');
                      }
                      seriesCallback(err);
                    });
                  },
                  function(seriesCallback) {
                    // Now flatten the themeSettings
                    async.eachSeries(_.keys(themeSettings), function(key, innerCallback) {
                      if (key === '_type') {
                        return innerCallback();
                      }
                      if (typeof themeSettings[key] !== 'object') {
                        savedSettings[key] = themeSettings[key];
                        return innerCallback();
                      }
                      // Iterate the properies and add them to the array
                      async.each(_.keys(themeSettings[key]), function(childKey, secondInnerCallback) {
                        savedSettings[key + SEPARATOR + childKey] = themeSettings[key][childKey];
                        secondInnerCallback();
                      }, function(err) {
                        if (err) {
                          logger.log('error', 'Theme customisations 2 of 4 -- error flattening themeSettings');
                        }
                        innerCallback(err);
                      });
                    }, function(err) {
                      if (err) {
                        logger.log('error', 'Theme customisations 2 of 4');
                      }
                      seriesCallback(err);
                    });
                  },
                  function(seriesCallback) {
                    async.each(props, function(prop, innerCallback) {
                      if (!savedSettings.hasOwnProperty(prop) || theme.properties[prop].default === savedSettings[prop]) {
                        return innerCallback();
                      }
                      // if an image: split the path & encode filename (remove spaces etc.)
                      if (theme.properties[prop].inputType === 'Asset:image') {
                        var assetPathArray = savedSettings[prop].split('/');
                        assetPathArray[assetPathArray.length - 1] = encodeURIComponent(assetPathArray[assetPathArray.length - 1]);
                        savedSettings[prop] = assetPathArray.join('/').replace('course/', '');
                      }
                      // Search for LESS variables in the format: @variable-name: 'whatever';
                      var regex = new RegExp(prop + ':{1}[^;]+;');
                      file = file.replace(regex, `${prop}: ${savedSettings[prop]}; // REPLACED AT BUILD-TIME`);

                      innerCallback();

                    }, function(err) {
                      if (err) {
                        logger.log('error', 'Theme customisations 3 of 4');
                      }
                      seriesCallback(err);
                    });
                  },
                  function(seriesCallback) {
                    fs.writeFile(path.join(destinationFolder, Constants.Folders.Less, item), file, 'utf8', function (err) {
                      if (err) {
                        logger.log('error', 'Theme customisations 4 of 4');
                      }
                      seriesCallback(err);
                    });
                  }
                ], eachCallback);
              });
            }, function() {
              if (err) {
                logger.log('error', err);
                return next(err);
              }
              var processedAssets = [];
              // Process assets
              database.getDatabase(function (err, db) {
                if (err) {
                  return next(err, 'Unable to connect to database');
                }
                db.retrieve('courseasset', { _courseId: courseId, _contentType: 'theme' }, function (err, results) {
                  if (err) {
                    return next(err);
                  }
                  if (!results) {
                    return next();
                  }
                  // Process each asset in turn
                  async.eachSeries(results, function(result, callback) {
                    // Retrieve the asset details
                    assetmanager.retrieveAsset({ _id: result._assetId }, function (error, assets) {
                      if (error) {
                        return callback(error);
                      }
                      var asset = assets[0];
                      var outputFilename = path.join(themeAssetsFolder, asset.filename);
                      // Ensure that an asset is only copied once
                      if (processedAssets[asset.filename]) {
                        return callback();
                      }
                      processedAssets[asset.filename] = true;
                      // AB-59 - can't use asset record directly - need to use storage plugin
                      filestorage.getStorage(asset.repository, function (err, storage) {
                        if (err) {
                          logger.log('error', err.message, err);
                          return callback(err);
                        }
                        return storage && storage.createReadStream(asset.path, function (ars) {
                          var aws = fs.createWriteStream(outputFilename);
                          ars.on('error', function (err) {
                            return callback('Error copying ' + asset.path + ' to ' + outputFilename + ": " + err.message);
                          });
                          ars.on('end', function () {
                            return callback();
                          });
                          ars.pipe(aws);
                        });
                      });
                    });
                  }, function(err) {
                    if (err) {
                      logger.log('error', 'Unable to process theme assets');
                      return next(err);
                    }
                    logger.log('info', 'All theme assets processed');

                    next(null, destinationFolder.split(path.sep).pop());
                  });
                });
              });
            });
          });
        });
      });
    });
  }, configuration.getConfig('dbName'));
};

OutputPlugin.prototype.writeCustomStyle = function(tenantId, courseId, destinationFolder, next) {
  database.getDatabase(function(err, db) {
    if (err) {
      logger.log('error', err);
      return next(err);
    }
    db.retrieve('course', { _id: courseId }, { json: true }, function(err, results) {
      if (err) {
        logger.log('error', err);
        return next(err);
      }
      if (!results || results.length > 1) {
        logger.log('info', 'More than one course record');
        return next(err);
      }
      if (!results[0].customStyle) {
        return next(null, 'No custom LESS file required');
      }
      var filename = path.join(destinationFolder, Constants.Folders.Less, Constants.Filenames.CustomStyle);

      fs.outputFile(filename, results[0].customStyle, 'utf8', function(err) {
        if (err) {
          logger.log('error', err);
          return next(err);
        }
        return next(null, 'Custom LESS file written');
      });
    });
  }, tenantId);
};

OutputPlugin.prototype.writeCourseAssets = function(tenantId, courseId, destinationFolder, jsonObject, next) {
  rimraf(destinationFolder, function(err) {
    if (err) {
      return next(err);
    }
    // Remove any existing assets
    fs.ensureDir(destinationFolder, function(err) {
      if (err) {
        return next(err);
      }
      // Fetch assets used in the course
      database.getDatabase(function (err, db) {
        if (err) {
          return next(err);
        }
        // Retrieve a distinct list of assets.
        db.retrieve('courseasset', { _courseId: courseId, _contentType: { $ne: 'theme' } }, { operators: { distinct: '_assetId' } }, function (err, results) {
          if (err) {
            logger.log('error', err);
            return next(err);
          }
          if (!results) {
            return next(null, jsonObject);
          }
          // Retrieve the details of every asset used in this course.
          assetmanager.retrieveAsset({ _id: { $in: results } }, function (error, assets) {
            if (error) {
              logger.log('error', err);
              return next(error);
            }
            async.eachSeries(assets, function(asset, callback) {
              // FIXME -- This global replace is intended as a temporary solution
              var replaceRegex = new RegExp("course/assets/" + asset.filename, 'gi');
              var lang = jsonObject['config']._defaultLanguage;
              var newAssetPath = "course/" + lang + "/assets/" + encodeURIComponent(asset.filename);

              Object.keys(Constants.CourseCollections).forEach(function(key) {
                jsonObject[key] = JSON.parse(JSON.stringify(jsonObject[key]).replace(replaceRegex, newAssetPath));
              });
              // AB-59 - can't use asset record directly - need to use storage plugin
              filestorage.getStorage(asset.repository, function (err, storage) {
                if (err) {
                  logger.log('error', err.message, err);
                  return callback(err);
                }
                return storage && storage.createReadStream(asset.path, function (ars) {
                  var outputFilename = path.join(destinationFolder, asset.filename);
                  var aws = fs.createWriteStream(outputFilename);
                  ars.on('error', function (err) {
                    logger.log('error', 'Error copying ' + asset.path + ' to ' + outputFilename + ": " + err.message);
                    return callback('Error copying ' + asset.path + ' to ' + outputFilename + ": " + err.message);
                  });
                  ars.on('end', function () {
                    return callback();
                  });
                  ars.pipe(aws);
                });
              });
            }, function(err) {
              if (err) {
                logger.log('error', 'Error processing course assets');
                return next(err);
              }
              logger.log('info', 'All assets processed');
              return next(null, jsonObject);
            });
          }); // retrieveAsset()
        }); //courseasset
      }, tenantId);
    });  // ensureDir()
  }); // rimRaf()
};

OutputPlugin.prototype.applyMenu = function(tenantId, courseId, jsonObject, destinationFolder, next) {
  return next(null, jsonObject.config._menu || Constants.Defaults.MenuName);
  /*
  // Retrieve any menu customisations on this course
  var menuSettings = jsonObject.course.menuSettings;
  var menuName = jsonObject.config._menu || Constants.Defaults.MenuName;
  // Check if the menu selected has customisations
  if (!menuSettings) {
    return next(null, menuName);
  }
  database.getDatabase(function (err, db) {
    if (err) {
      logger.log('error', err);
      return next(err, 'Unable to connect to database');
    }
    // Get the menu type
    db.retrieve('menutype', { name: menuName }, {}, function(err, results) {
      if (err) {
        return next(err, 'Unable to retrieve menutype with name ' + menuName);
      }
      if (!results || results.length > 1) {
        return next(null, menuName);
      }
      // Remove any current temporary menu folder
      fs.remove(destinationFolder, function (err) {
        if (err) {
          // Log the error but try to continue
          logger.log('error', err);
        }
        var menuFolder = path.join(configuration.tempDir, configuration.getConfig('masterTenantID'), Constants.Folders.Framework, Constants.Folders.Source, Constants.Folders.Menu, results[0].name);
        fs.copy(menuFolder, destinationFolder, function (err) {
          if (err) {
            return next(err);
          }
          // Get the name from the destinationFolder
          return next(null, destinationFolder.replace(MENU_ROOT + path.sep, ''));
        });
      });
    });
  }, configuration.getConfig('dbName'));
  */
};

/**
 * extending plugins must implement this
 *
 * @return {string}
 */
OutputPlugin.prototype.preview = function (courseId, req, res, next) {
  logger.log('error', 'OutputPlugin#preview must be implemented by extending objects!');
  throw new Error('OutputPlugin#preview must be implemented by extending objects!');
};

/**
 * extending plugins must implement this
 *
 * @return {string}
 */
OutputPlugin.prototype.publish = function (courseId, req, res, next) {
  logger.log('error', 'OutputPlugin#publish must be implemented by extending objects!');
  throw new Error('OutputPlugin#publish must be implemented by extending objects!');
};

/**
 * extending plugins must implement this
 *
 * @return {string}
 */
OutputPlugin.prototype.export = function (courseId, req, res, next) {
  logger.log('error', 'OutputPlugin#export must be implemented by extending objects!');
  throw new Error('OutputPlugin#export must be implemented by extending objects!');
};

/**
 * Returns a slugified string, e.g. for use in a published filename
 *
 * @return {string}
 */
OutputPlugin.prototype.slugify = function(s) {
  var _slugify_strip_re = /[^\w\s-]/g;
  var _slugify_hyphenate_re = /[-\s]+/g;

  s = s.replace(_slugify_strip_re, '').trim().toLowerCase();
  s = s.replace(_slugify_hyphenate_re, '-');

  return s;
};

/**
 * OutputManager class
 */

function OutputManager () {
  this._outputTypes = Object.create(null);
}

// OutputManager is an eventemitter
util.inherits(OutputManager, EventEmitter);

/**
 * gets an output plugin instance
 *
 * @param {string} type - the type(name) of the output plugin
 * @param {callback} cb
 */

OutputManager.prototype.getOutputPlugin = function (type, cb) {
  var self = this;
  if (self._outputTypes[type]) {
    return cb(null, self._outputTypes[type]);
  }
  var pluginManager = pluginmanager.getManager();
  pluginManager.getPlugin('output', type, function (error, pluginInfo) {
    if (error) {
      return cb(new Error('output type plugin ' + type + ' was not found'));
    }
    try {
      var OutputPlugin = require(pluginInfo.fullPath);
      self._outputTypes[type] = new OutputPlugin(); // not sure we need to memoize
      cb(null, self._outputTypes[type]);
    } catch (err) {
      return cb(err);
    }
  });
};

/**
 * sets up rest service routes
 */
OutputManager.prototype.setupRoutes = function () {
  var outputmanager = this;
  // Publish for preview
  rest.get('/output/:type/preview/:courseid', function (req, res, next) {
    var type = req.params.type;
    var courseId = req.params.courseid;
    var user = usermanager.getCurrentUser();
    var mode = Constants.Modes.preview;

    outputmanager.publish(type, courseId, mode, req, res, function (error, result) {
      if (error) {
        logger.log('error', error);
        return res.status(500).json({ success: false, message: error.message });
      }
      res.status(200).json({ success: true, payload: result });
    });
  });

  rest.get('/output/:type/publish/:courseid', function (req, res, next) {
    logger.log('info', 'About to publish');
    var type = req.params.type;
    var courseId = req.params.courseid;
    var mode = Constants.Modes.publish;

    outputmanager.publish(type, courseId, mode, req, res, function (error, result) {
      if (error) {
        logger.log('error', 'Unable to publish');
        return res.status(500).json({ success: false, message: error.message });
      }
      res.status(200).json({ success: true, payload: result });
    });
  });

};

["preview", "publish"].forEach( function (el, index, array) {
  OutputManager.prototype[el] = function () {
    var callargs = arguments;
    var args = Array.prototype.slice.call(arguments);
    var type = args.shift();
    var cb = args[args.length - 1];

    this.getOutputPlugin(type, function (error, plugin) {
      if (error) {
        return cb(error);
      }
      return plugin[el].apply(plugin, args);
    });
  };
});

exports = module.exports = {
  // expose the output manager constructor
  OutputManager: OutputManager,
  // expose the output plugin constructor
  OutputPlugin: OutputPlugin,
  // expose the constants
  Constants: Constants,
  /**
   * preload function
   *
   * @param {object} app - the Origin instance
   * @return {object} preloader - a ModulePreloader
   */
  preload : function (app) {
    var preloader = new app.ModulePreloader(app, MODNAME, { events: this.preloadHandle(app, new OutputManager()) });
    return preloader;
  },

  /**
   * Event handler for preload events
   *
   * @param {object} app - Server instance
   * @param {object} instance - Instance of this module
   * @return {object} hash map of events and handlers
   */
  preloadHandle: function(app, instance) {
    return {
      preload: function() {
        var preloader = this;
        preloader.emit('preloadChange', MODNAME, app.preloadConstants.WAITING);
      },
      moduleLoaded: function(modloaded) {
        var preloader = this;
         //is the module that loaded this modules requirement
        if(modloaded === WAITFOR) {
          app.outputmanager = instance;
          instance.setupRoutes();
          preloader.emit('preloadChange', MODNAME, app.preloadConstants.COMPLETE);
        }
      }
    };
  }
};
