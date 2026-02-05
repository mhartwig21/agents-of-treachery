# Secrets Architecture and Threat Model

This document defines the secrets management architecture for Agents of Treachery (AoT), a multi-agent Diplomacy simulation platform that integrates with various LLM providers.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Asset Inventory](#asset-inventory)
3. [Threat Model](#threat-model)
4. [Technology Evaluation](#technology-evaluation)
5. [Recommended Architecture](#recommended-architecture)
6. [Implementation Guidelines](#implementation-guidelines)

---

## Architecture Overview

### Current State

The application currently relies on environment variables for secrets:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Current Flow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Developer Machine                                              │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │   .env file  │ ──▶ │  process.env │ ──▶ │  LLM Client  │   │
│   │  (gitignored)│     │              │     │              │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Proposed Flow                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐  │
│   │   Secret    │     │   Key Service    │     │   Application       │  │
│   │   Store     │◀───▶│   (Decryption)   │◀───▶│   Runtime           │  │
│   │             │     │                  │     │                     │  │
│   │  ┌───────┐  │     │  ┌────────────┐  │     │  ┌───────────────┐  │  │
│   │  │ age   │  │     │  │ Master Key │  │     │  │ LLM Provider  │  │  │
│   │  │encrypted│ │     │  │ (env/file) │  │     │  │   Clients     │  │  │
│   │  │ files │  │     │  └────────────┘  │     │  └───────────────┘  │  │
│   │  └───────┘  │     │                  │     │                     │  │
│   └─────────────┘     └──────────────────┘     └─────────────────────┘  │
│                                                                          │
│   Git Repository                                                         │
│   (encrypted secrets                                                     │
│    committed safely)                                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                      Key Hierarchy                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Level 1: Master Key (age identity)                            │
│   ├── Stored: Developer machine (~/.config/aot/age-key.txt)     │
│   ├── CI/CD: Environment variable (AGE_SECRET_KEY)              │
│   └── Purpose: Decrypt all data encryption keys                 │
│                                                                  │
│   Level 2: Data Encryption Keys (DEKs)                          │
│   ├── One per environment (dev, staging, prod)                  │
│   ├── Encrypted by master key                                   │
│   └── Purpose: Encrypt actual secrets                           │
│                                                                  │
│   Level 3: Application Secrets                                  │
│   ├── API keys, tokens, credentials                             │
│   ├── Encrypted by environment DEK                              │
│   └── Purpose: Runtime authentication                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Asset Inventory

### Secrets Currently in Use

| Secret | Environment Variable | Usage Location | Sensitivity |
|--------|---------------------|----------------|-------------|
| Anthropic API Key | `ANTHROPIC_API_KEY` | `src/experiment/runner.ts`, `src/server/providers.ts` | High |
| OpenAI API Key | `OPENAI_API_KEY` | `src/experiment/runner.ts`, `src/server/providers.ts` | High |
| OpenRouter API Key | `OPENROUTER_API_KEY` | `src/experiment/runner.ts`, `src/server/providers.ts` | High |

### Sensitivity Classifications

- **High**: API keys with billing implications or data access (all LLM provider keys)
- **Medium**: Internal service credentials without direct cost implications
- **Low**: Non-sensitive configuration values

### Data Flow: Secret Read Operation

```
┌─────────────────────────────────────────────────────────────────┐
│                    Secret Read Flow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. Application startup                                         │
│      └──▶ SecretService.initialize()                            │
│                                                                  │
│   2. Load encrypted secrets file                                 │
│      └──▶ Read: secrets/secrets.age                             │
│                                                                  │
│   3. Decrypt with master key                                     │
│      └──▶ age --decrypt -i ~/.config/aot/age-key.txt            │
│                                                                  │
│   4. Parse decrypted YAML/JSON                                  │
│      └──▶ { ANTHROPIC_API_KEY: "sk-...", ... }                  │
│                                                                  │
│   5. Inject into process.env                                     │
│      └──▶ process.env.ANTHROPIC_API_KEY = decrypted.value       │
│                                                                  │
│   6. Application uses secrets normally                           │
│      └──▶ process.env.ANTHROPIC_API_KEY                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Threat Model

### STRIDE Analysis

#### Spoofing (Identity)

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| T1 | Attacker impersonates developer to access secrets | Medium | High | Use SSH keys for git, MFA on secret storage |
| T2 | Malicious CI job accesses production secrets | Low | Critical | Separate CI credentials, audit logs |

#### Tampering (Integrity)

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| T3 | Attacker modifies encrypted secrets file | Low | High | Git commit signing, PR reviews |
| T4 | Compromised dependency injects malicious code | Medium | Critical | Lockfile integrity, dependency audit |

#### Repudiation (Non-repudiation)

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| T5 | Secret access without audit trail | Medium | Medium | Implement access logging |
| T6 | Denied key rotation timing | Low | Low | Automated rotation with timestamps |

#### Information Disclosure

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| T7 | Secrets leaked in logs | Medium | High | Redact secrets in logging |
| T8 | Secrets committed to git | High | Critical | Pre-commit hooks, .gitignore |
| T9 | Secrets in error messages | Medium | High | Sanitize error outputs |
| T10 | Memory dump reveals secrets | Low | High | Minimize secret lifetime in memory |

#### Denial of Service

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| T11 | Master key unavailable | Low | High | Key backup procedures |
| T12 | Encrypted file corrupted | Low | Medium | Git history recovery |

#### Elevation of Privilege

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| T13 | Developer accesses prod secrets | Medium | High | Environment separation |
| T14 | Application gains file system access | Low | Medium | Minimal file permissions |

### Attack Vectors

#### 1. Compromised Developer Machine

**Scenario**: Attacker gains access to a developer's workstation.

**Current Exposure**:
- `.env` file contains plaintext secrets
- Shell history may contain secrets
- IDE configurations may cache secrets

**Mitigations**:
- Encrypt secrets at rest with age
- Short-lived secrets where possible
- Full disk encryption required
- Auto-lock policies

#### 2. Insider Threat

**Scenario**: Malicious or negligent team member.

**Current Exposure**:
- All developers can access all secrets
- No audit trail for secret access

**Mitigations**:
- Role-based access to secret files
- Separate keys per environment
- Access logging
- Regular key rotation

#### 3. Supply Chain Attack

**Scenario**: Compromised npm package steals environment variables.

**Current Exposure**:
- `process.env` is globally accessible
- No runtime secret isolation

**Mitigations**:
- Audit dependencies (`npm audit`)
- Use lockfiles
- Consider runtime secret isolation
- Monitor for unexpected network calls

#### 4. Git History Exposure

**Scenario**: Secrets accidentally committed to repository.

**Current Exposure**:
- `.env` in `.gitignore` prevents current commits
- Historical commits may contain secrets

**Mitigations**:
- Pre-commit hooks (gitleaks, git-secrets)
- Repository scanning
- Encrypted secrets committed intentionally

### OWASP Top 10 Relevance

| OWASP Category | Relevance | Addressed By |
|----------------|-----------|--------------|
| A01: Broken Access Control | High | Environment separation, RBAC |
| A02: Cryptographic Failures | High | age encryption, key rotation |
| A03: Injection | Low | Not applicable to secrets |
| A04: Insecure Design | Medium | This architecture document |
| A05: Security Misconfiguration | High | Pre-commit hooks, audits |
| A06: Vulnerable Components | Medium | Dependency auditing |
| A07: Auth Failures | High | Key management, MFA |
| A08: Integrity Failures | Medium | Commit signing, reviews |
| A09: Logging Failures | Medium | Secret redaction, access logs |
| A10: SSRF | Low | Not applicable |

---

## Technology Evaluation

### Comparison Matrix

| Criteria | age + sops | HashiCorp Vault | AWS Secrets Manager | Direct .env |
|----------|-----------|-----------------|---------------------|-------------|
| **Setup Complexity** | Low | High | Medium | None |
| **Operational Burden** | Low | High | Low | None |
| **Cost** | Free | Free/Paid | Pay per secret | Free |
| **Git Integration** | Excellent | Poor | Poor | N/A |
| **Rotation Support** | Manual | Automatic | Automatic | Manual |
| **Audit Logging** | Git history | Built-in | Built-in | None |
| **Team Scaling** | Good | Excellent | Good | Poor |
| **Local Dev Experience** | Good | Complex | Requires AWS | Simple |
| **CI/CD Integration** | Simple | Complex | Simple | Simple |
| **Security Level** | High | Very High | High | Low |

### Detailed Evaluation

#### 1. age + sops

**Description**: `age` is a simple, modern encryption tool. `sops` (Secrets OPerationS) provides a layer for managing encrypted files with support for multiple key types.

**Pros**:
- Simple CLI interface
- Encrypted files can be committed to git
- No external service dependency
- Free and open source
- Supports partial file encryption (sops)

**Cons**:
- Manual key distribution
- No built-in rotation
- No access logging beyond git

**Best For**: Small to medium teams, local development, git-centric workflows.

#### 2. HashiCorp Vault

**Description**: Enterprise-grade secrets management platform with dynamic secrets, leasing, and comprehensive audit logging.

**Pros**:
- Dynamic secret generation
- Automatic rotation
- Fine-grained access control
- Comprehensive audit logs
- Multi-cloud support

**Cons**:
- Significant operational complexity
- Requires running infrastructure
- Steep learning curve
- Overkill for small projects

**Best For**: Large enterprises, complex compliance requirements, dynamic infrastructure.

#### 3. AWS Secrets Manager

**Description**: Managed service for secrets with automatic rotation and IAM integration.

**Pros**:
- Fully managed
- Automatic rotation for AWS services
- IAM integration
- Audit via CloudTrail

**Cons**:
- AWS lock-in
- Cost per secret ($0.40/secret/month)
- Requires AWS credentials for local dev
- Network dependency

**Best For**: AWS-native applications, teams already using AWS.

#### 4. Direct .env (Current State)

**Pros**:
- Zero setup
- Familiar pattern
- No dependencies

**Cons**:
- No encryption at rest
- No team sharing mechanism
- No audit trail
- Easy to leak

**Best For**: Solo development, prototypes.

---

## Recommended Architecture

### Recommendation: age + sops

For Agents of Treachery, we recommend **age with sops** for the following reasons:

1. **Right-sized complexity**: The project is in active development with a small team. Vault or cloud services add unnecessary operational burden.

2. **Git-centric workflow**: Encrypted secrets can be committed to the repository, ensuring secrets are versioned alongside code.

3. **Zero external dependencies**: Works offline, no cloud accounts required.

4. **Clear upgrade path**: If requirements grow, migration to Vault or cloud services is straightforward.

### Implementation Structure

```
project/
├── secrets/
│   ├── .sops.yaml           # sops configuration
│   ├── dev.secrets.yaml     # Encrypted dev secrets
│   ├── staging.secrets.yaml # Encrypted staging secrets
│   └── prod.secrets.yaml    # Encrypted prod secrets
├── scripts/
│   ├── secrets-decrypt.ts   # Decrypt and inject secrets
│   └── secrets-edit.ts      # Edit encrypted secrets
└── docs/
    └── security/
        └── secrets-architecture.md  # This document
```

### sops Configuration (.sops.yaml)

```yaml
creation_rules:
  - path_regex: secrets/dev\.secrets\.yaml$
    age: >-
      age1dev...  # Dev team public key
  - path_regex: secrets/staging\.secrets\.yaml$
    age: >-
      age1staging...  # Staging key (CI/CD)
  - path_regex: secrets/prod\.secrets\.yaml$
    age: >-
      age1prod...  # Production key (restricted)
```

### Secret File Format (before encryption)

```yaml
# secrets/dev.secrets.yaml
ANTHROPIC_API_KEY: sk-ant-...
OPENAI_API_KEY: sk-...
OPENROUTER_API_KEY: sk-or-...
```

---

## Implementation Guidelines

### Developer Onboarding

1. Install age: `brew install age` (macOS) or equivalent
2. Generate personal key: `age-keygen -o ~/.config/aot/age-key.txt`
3. Share public key with team lead for addition to `.sops.yaml`
4. Receive encrypted secrets access

### Secret Rotation

1. **Planned Rotation** (quarterly):
   - Generate new API keys from providers
   - Update encrypted files: `sops secrets/dev.secrets.yaml`
   - Commit and deploy

2. **Emergency Rotation** (compromise suspected):
   - Immediately revoke compromised keys at provider
   - Generate new keys
   - Update all environments
   - Audit access logs

### CI/CD Integration

```yaml
# Example GitHub Actions
jobs:
  deploy:
    steps:
      - name: Decrypt secrets
        env:
          SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}
        run: |
          sops -d secrets/prod.secrets.yaml > .env
          source .env
```

### Pre-commit Hook

Add to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
```

### Logging and Monitoring

- Redact secrets from all logs
- Monitor LLM provider dashboards for unusual usage
- Set up billing alerts on API providers

---

## Appendix: Key Contacts

| Role | Responsibility |
|------|----------------|
| Security Lead | Key rotation, access reviews |
| DevOps | CI/CD secret configuration |
| Team Lead | Developer onboarding, key distribution |

---

*Document Version: 1.0*
*Last Updated: 2026-02-05*
*Author: Polecat bullet (aot-mzg71)*
