# tfdocs

A Visual Studio Code extension that helps you quickly look up Terraform resource definitions and module documentation directly from your code.

## Features

- **Resource Documentation**: 
  - Quickly access official Terraform documentation for resources and data sources
  - Version-specific documentation based on your `.terraform.lock.hcl` file

- **Module Navigation**: 
  - For local modules: Jump directly to the module's main configuration file
  - For registry modules: Open the module's documentation in the Terraform Registry
  - For private modules: Navigate to the module in your private registry (supports Terraform Cloud)

- **Smart Diagnostics**:
  - Visual indicators (yellow squiggly underlines) on resource and module blocks when `.terraform.lock.hcl` file is missing
  - Quick Fix actions to run terraform/tofu init directly from the diagnostic warnings
  - Real-time feedback as you work with Terraform files

- **Automatic Initialization**:
  - Detects missing `.terraform.lock.hcl` file and offers to run initialization
  - Initialization output displayed in VS Code Output panel for better visibility
  - Configurable to use either Terraform or OpenTofu
  - Optional color output support with smart ANSI code conversion for enhanced readability

## Usage

### Looking up Resources and Modules

1. Place your cursor on a Terraform resource, data source, or module declaration
2. Either:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) and run the "Look up Terraform resource" command
   - Use the "Go to Definition" feature (F12 or Ctrl+click)

### Handling Missing Lock Files

When working with Terraform files that don't have a `.terraform.lock.hcl` file, you'll see:
- **Yellow squiggly underlines** on resource and module declarations
- **Quick Fix options** (lightbulb icon or `Ctrl+.`) to run `terraform init` or `tofu init`
- **VS Code Output panel** showing real-time initialization progress
- **Enhanced output readability** when colorizer is enabled - ANSI color codes are converted to readable text labels like `[ERROR]`, `[SUCCESS]`, `[WARNING]`

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
| `tfdocs.enableColorizer` | Enable color output in Terraform/OpenTofu commands (removes -no-color flag and converts ANSI codes to readable text) | `false` |

You can add these to your settings.json:
```json
{
    "tfdocs.initTool": "tofu",
    "tfdocs.enableColorizer": true
}
```

## Known Issues

None at this time. Please report any issues on our GitHub repository.

> **Credits**: This extension is forked from the [terraform-docs-navigator](https://github.com/jeremyoverman/terraform-docs-navigator) by [Jeremy Overman](https://github.com/jeremyoverman).
