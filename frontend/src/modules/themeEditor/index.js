// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var ConfigModel = require('core/models/configModel');

  var EditorThemingView = require('./views/editorThemingView.js');
  var EditorThemingSidebarView = require('./views/editorThemingSidebarView.js');

  var ROUTE = 'edittheme';

  Origin.on('editorCommon:theme', function() {
    Origin.router.navigateTo('editor/' + Origin.editor.data.course.get('_id') + '/' + ROUTE);
  });

  Origin.on('router:editor', function(route1, route2, route3, route4) {
    if(route2 !== ROUTE) {
      return;
    }
    (new ConfigModel({ _courseId: route1 })).fetch({
      success: function(model) {
        Origin.sidebar.addView(new EditorThemingSidebarView().$el);
        Origin.contentPane.setView(EditorThemingView, { model: model });
      }
    });
  });
});
