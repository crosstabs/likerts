#!/usr/bin/env sh
set -eu
# Runs only when PostgreSQL initializes a new volume. psql quotes random values.
psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password LIKERTS_LOCAL_MIGRATOR_PASSWORD
\getenv runtime_password LIKERTS_LOCAL_RUNTIME_PASSWORD
create role likerts_migrator login noinherit nobypassrls nocreatedb nocreaterole password :'migrator_password';
create role likerts_runtime login noinherit nobypassrls nocreatedb nocreaterole password :'runtime_password';
create database likerts owner likerts_migrator;
SQL
