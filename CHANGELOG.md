# Change Log

All notable changes to the "tfdocs" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 1.0.0

New features:
- Added support for version-specific provider documentation using `.terraform.lock.hcl`
- Added automatic detection of missing initialization with prompt to run `terraform init`
- Added support for OpenTofu via the `tfdocs.initTool` setting

## 0.0.1

Initial release:
- Support for looking up Terraform resource and data source documentation
- Support for navigating to local modules
- Support for opening registry modules documentation
- Support for Terraform Cloud private modules