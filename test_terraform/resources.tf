# Has non-standard resource naming in the registry docs
resource "postgresql_grant" "non-hashicorp" {
  database    = "test_db"
  role        = "test_role"
  schema      = "public"
  object_type = "table"
  objects     = ["table1", "table2"]
  privileges  = ["SELECT"]
}

resource "aws_ssm_parameter" "hashicorp" {
  name  = "hashicorp"
  type  = "SecureString"
  value = "hashicorp"
}