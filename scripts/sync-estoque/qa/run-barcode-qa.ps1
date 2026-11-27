# =============================================================================
# Runs the Barcode Slice 1 QA integration test against the QA Supabase project.
# QA ONLY — the test resets the estoque current-state tables of its target.
#
#   .\scripts\sync-estoque\qa\run-barcode-qa.ps1 [-PgRoot <portable PG17 client dir>]
#
# Needs a PostgreSQL 17 client with bin\psql.exe, plus conf\pgpass.conf (QA
# entry, user-only ACL) and conf\supabase-prod-ca-2021.crt under -PgRoot. Every
# connection setting is set for this process only and removed afterwards; no
# password is ever on a command line.
# =============================================================================
param(
  [string]$PgRoot = "C:\Users\benvi\Tools\postgresql17",
  [string]$PgHost = "aws-1-sa-east-1.pooler.supabase.com",
  [string]$QaProjectRef = "fupdeihsucacsprunljk",
  [string]$ExpectedSystemIdentifier = "7702070854497379551"
)
$ErrorActionPreference = "Stop"
if ($QaProjectRef -eq "ugfogsseikupsfqqznzi") { throw "Refusing: that is the PRODUCTION project ref." }

$vars = @{
  PGHOST                         = $PgHost
  PGPORT                         = "5432"
  PGDATABASE                     = "postgres"
  PGUSER                         = "postgres.$QaProjectRef"
  PGSSLMODE                      = "verify-full"
  PGSSLROOTCERT                  = "$PgRoot\conf\supabase-prod-ca-2021.crt"
  PGPASSFILE                     = "$PgRoot\conf\pgpass.conf"
  PGAPPNAME                      = "portal-barcode-qa"
  QA_PSQL                        = "$PgRoot\bin\psql.exe"
  QA_EXPECTED_SYSTEM_IDENTIFIER  = $ExpectedSystemIdentifier
}
foreach ($k in $vars.Keys) { Set-Item "Env:$k" $vars[$k] }
try {
  $ErrorActionPreference = "Continue"
  node (Join-Path $PSScriptRoot "test-barcode-qa.mjs")
  exit $LASTEXITCODE
} finally {
  foreach ($k in $vars.Keys) { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
}
