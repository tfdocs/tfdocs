# Terraform Docs Navigator

A Visual Studio Code extension that helps you quickly look up Terraform resource definitions and module documentation directly from your code.

## Features

- **Resource Documentation**: Quickly access official Terraform documentation for resources and data sources
- **Module Navigation**: 
  - For local modules: Jump directly to the module's main configuration file
  - For registry modules: Open the module's documentation in the Terraform Registry
  - For private modules: Navigate to the module in your private registry (supports Terraform Cloud)

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

This extension activates automatically for Terraform files. No additional configuration is required.

## Known Issues

None at this time. Please report any issues on our GitHub repository.

## Release Notes

### 0.0.1

Initial release:
- Support for looking up Terraform resource and data source documentation
- Support for navigating to local modules
- Support for opening registry modules documentation
- Support for Terraform Cloud private modules

