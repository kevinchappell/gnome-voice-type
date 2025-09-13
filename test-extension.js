#!/usr/bin/gjs

// Test script to validate extension syntax
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

// Mock the required GNOME Shell imports
var imports = {
    ui: {
        main: { panel: {} },
        panelMenu: { Button: function() {} }
    },
    gi: {
        GObject: { registerClass: function() {} },
        St: { Icon: function() {} },
        Gio: Gio,
        GLib: GLib,
        Soup: {},
        Clutter: {},
        Meta: {}
    },
    misc: {
        extensionUtils: {
            getCurrentExtension: function() { 
                return { dir: { get_path: function() { return '/tmp'; } } }; 
            }
        }
    }
};

try {
    // Load the extension
    let extensionCode = GLib.file_get_contents('extension.js')[1];
    eval(extensionCode);
    print('Extension syntax appears valid');
} catch (e) {
    print('Extension error: ' + e.message);
}