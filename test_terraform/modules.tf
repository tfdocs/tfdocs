module "external-module" {
  source   = "terraform-aws-modules/ecs/aws"
}

module "external-sub-module" {
  source   = "terraform-aws-modules/ecs/aws//modules/service"
  name        = "External Submodule"
}

module "local-module" {
  source = "./modules/my_module"
}

module "registry-module" {
  source  = "app.terraform.io/my-org/my-app/my-provider"
  version = "~> 3.1"
}