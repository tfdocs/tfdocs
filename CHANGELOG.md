# Change Log

All notable changes to the "tfdocs" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 1.3.0 (TBD)

New features:
- **Version Constraint Strategy**: Added `tfdocs.useConstraint` setting to control which version to use from Terraform lock file constraints with options: `low` (lowest version), `middle` (middle version), and `high` (default - uses lock file version directly)
- **Smart Constraint Parsing**: Automatically parses constraint strings (e.g., `">= 1.6.0, >= 1.7.0"`) to extract available versions and applies the selected strategy
- **Variable Link Navigation**: Added Ctrl+click functionality for variables within resource blocks to open documentation with variable-specific hash anchors
- **Smart Hash Generation**: Variables now generate appropriate hash anchors based on nesting level (e.g., `#name` for root-level, `#auto_delete-2` for nested variables)
- **Enhanced Variable Hover**: Hover tooltips for variables now display the exact hash anchor that will be used in the documentation URL
- **Improved Variable Detection**: Better detection and highlighting of variable assignments in resource and data source blocks

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