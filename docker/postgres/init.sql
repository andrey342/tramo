-- Runs once, when the data volume is first initialised. One schema per bounded context;
-- migrations also create them idempotently so test databases do not depend on this file.
CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS origination;
CREATE SCHEMA IF NOT EXISTS lending;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS notifications;
CREATE SCHEMA IF NOT EXISTS reporting;
