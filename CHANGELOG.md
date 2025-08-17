# Change Log

All notable changes to the "tfdocs" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 1.2.0 (August 17, 2025)

New features:
- **Enhanced Hover Documentation**: Hover tooltips now display provider information including namespace, version from lock file, and resource type details alongside documentation links
- **Schema-based Documentation**: Added rich documentation display using Terraform/OpenTofu provider schema command, showing detailed argument and block information directly in hover tooltips

Bug fixes:
- **Fixed Notification Persistence**: Resolved issue where "Run terraform init" warning notification would remain visible during initialization process. Now replaced with progress notification that automatically dismisses when complete.

## 1.1.0 (August, 17, 2025)

New features:
- **Visual Diagnostics**: Added yellow squiggly underlines (warning indicators) on resource and module blocks when `.terraform.lock.hcl` file is missing
- **Quick Fix Actions**: Added lightbulb quick fixes to run `terraform init` or `tofu init` directly from diagnostic warnings
- **Enhanced Output**: Terraform/OpenTofu initialization now outputs to VS Code Output panel with real-time progress updates
- **Color Output Support**: Added `tfdocs.enableColorizer` setting to enable color output with smart ANSI code conversion to readable text labels
- **Improved User Experience**: Automatic diagnostic updates when lock files are created or deleted
- **Interactive Hover Documentation**: Hover over resource types and modules to see documentation previews with clickable links
- **Ctrl+Hover Underlines**: Visual underlines appear when Ctrl+hovering over resource types and modules, indicating they are clickable
- **Enhanced Navigation**: Ctrl+click on resource types to open documentation or on modules to navigate to local files or registry pages

## 1.0.0 (August, 16, 2025)

New features:
- Added support for version-specific provider documentation using `.terraform.lock.hcl`
- Added automatic detection of missing initialization with prompt to run `terraform init`
- Added support for OpenTofu via the `tfdocs.initTool` setting

## 0.0.1 (March 26, 2025)

Initial release:
- Support for looking up Terraform resource and data source documentation
- Support for navigating to local modules
- Support for opening registry modules documentation
- Support for Terraform Cloud private modules