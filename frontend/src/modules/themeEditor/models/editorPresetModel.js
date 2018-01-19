// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
	var ContentModel = require('core/models/contentModel');

	var EditorPresetModel = ContentModel.extend({
		urlRoot: '/api/content/themepreset',
	});

	return EditorPresetModel;
});
