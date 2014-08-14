define(function(require) {
    
    var Origin = require('coreJS/app/origin');
    var SidebarItemView = require('coreJS/sidebar/views/sidebarItemView');
    var Backbone = require('backbone');
    var EditorComponentModel = require('editorPage/models/editorComponentModel');

    var EditorComponentListSidebarView = SidebarItemView.extend({

        events: {
            'click .editor-component-list-sidebar-save': 'onSaveClicked',
            'click .editor-component-list-sidebar-save-edit': 'onSaveAndEditClicked',
            'click .editor-component-list-sidebar-cancel': 'cancelEditing'
        },

        onSaveClicked: function(event) {
            event.preventDefault();

            if (!this.model.get('component') || !this.model.get('layout')) {
              return;
            }

            var componentType = _.find(Origin.editor.data.componentTypes.models, function(type){
              return type.get('name') == this.model.get('component');
            }, this);

            var _this = this;
            var newComponentModel = new EditorComponentModel();

            newComponentModel.save({
              title: 'Component title',
              displayTitle: '',
              body: '',
              _parentId: this.model.get('_parentId'),
              _courseId: Origin.editor.data.course.get('_id'),
              _type: 'component',
              _componentType: componentType.get('_id'),
              _component: componentType.get('component'),
              _layout: this.model.get('layout'),
              version: componentType.get('version')
            },
            {
              error: function() {
                alert('error adding new component');
              },
              success: function() {
                Origin.trigger('editor:refreshData', function() {
                    Backbone.history.history.back();
                    Origin.trigger('editingOverlay:views:hide');
                }, this);
              }
            });
        },

        onSaveAndEditClicked: function() {
            event.preventDefault();

            if (!this.model.get('component') || !this.model.get('layout')) {
              return;
            }

            var componentType = _.find(Origin.editor.data.componentTypes.models, function(type){
              return type.get('name') == this.model.get('component');
            }, this);

            var _this = this;
            var newComponentModel = new EditorComponentModel();

            newComponentModel.save({
              title: 'Component title',
              displayTitle: '',
              body: '',
              _parentId: this.model.get('_parentId'),
              _courseId: Origin.editor.data.course.get('_id'),
              _type: 'component',
              _componentType: componentType.get('_id'),
              _component: componentType.get('component'),
              _layout: this.model.get('layout'),
              version: componentType.get('version')
            },
            {
              error: function() {
                alert('error adding new component');
              },
              success: function(data) {
                Origin.trigger('editor:refreshData', function() {
                    Origin.trigger('editingOverlay:views:hide');
                    //Origin.trigger('editorView:fetchData');
                    Backbone.history.navigate('#/editor/' 
                        + Origin.editor.data.course.get('_id') 
                        + '/component/' 
                        + data.get('_id')); 
                }, this);
                               
              }
            });
        },

        cancelEditing: function(event) {
            event.preventDefault();
            var currentCourseId = Origin.location.route1;
            var currentBlockId = Origin.location.route3;
            var currentBlock = Origin.editor.data.blocks.findWhere({_id: currentBlockId});
            // Don't like this line but until we have findAncestor this will do
            var currentPage = currentBlock.getParent().getParent();
            var currentPageId = currentPage.get('_id');

            Backbone.history.navigate('#/editor/' + currentCourseId + '/page/' + currentPageId);
            Origin.trigger('editingOverlay:views:hide');
            
        }

    }, {
        template: 'editorComponentListSidebar'
    });

    return EditorComponentListSidebarView;

});