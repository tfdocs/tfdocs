# tfdocs

A Visual Studio Code extension that helps you quickly look up Terraform resource definitions and module documentation directly from your code.

> **Credits**: This extension is forked from the [terraform-docs-navigator](https://github.com/jeremyoverman/terraform-docs-navigator) by [Jeremy Overman](https://github.com/jeremyoverman).

## Features

- **Resource Documentation**: 
  - Quickly access official Terraform documentation for resources and data sources
  - Version-specific documentation based on your `.terraform.lock.hcl` file

- **Module Navigation**: 
  - For local modules: Jump directly to the module's main configuration file
  - For registry modules: Open the module's documentation in the Terraform Registry
  - For private modules: Navigate to the module in your private registry (supports Terraform Cloud)

- **Automatic Initialization**:
  - Detects missing `.terraform.lock.hcl` file and offers to run initialization
  - Configurable to use either Terraform or OpenTofu

## Usage

1. Place your cursor on a Terraform resource, data source, or module declaration
2. Either:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) and run the "Look up Terraform resource" command
   - Use the "Go to Definition" feature (F12 or Ctrl+click)

Example:
```hcl
resource "aws_instance" "web" {  # <- Place cursor here and trigger the command
  ami           = "ami-123456"
  instance_type = "t2.micro"
}
```

## Requirements

- Visual Studio Code version 1.98.0 or higher
- Terraform files in your workspace

## Extension Settings

This extension activates automatically for Terraform files. While no configuration is required, the following settings are available:

| Setting | Description | Default |
|---------|-------------|---------|
| `tfdocs.initTool` | Specify which tool to use for initialization when `.terraform.lock.hcl` is missing (`terraform` or `tofu`) | `terraform` |

You can add this to your settings.json:
```json
{
    "tfdocs.initTool": "tofu"
}
```

## Known Issues

None at this time. Please report any issues on our GitHub repository.

## Release Notes

### 1.0.0

New features:
- Added support for version-specific provider documentation using `.terraform.lock.hcl`
- Added automatic detection of missing initialization with prompt to run `terraform init`
- Added support for OpenTofu via the `tfdocs.initTool` setting

### 0.0.1

Initial release:
- Support for looking up Terraform resource and data source documentation
- Support for navigating to local modules
- Support for opening registry modules documentation
- Support for Terraform Cloud private modules

