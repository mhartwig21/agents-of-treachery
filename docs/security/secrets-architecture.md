# Secrets Architecture and Threat Model

This document describes the architecture, threat model, and technology recommendations for secrets management in Agents of Treachery.

## Table of Contents

1. [Overview](#overview)
2. [Architecture Document](#architecture-document)
3. [Threat Model](#threat-model)
4. [Technology Selection](#technology-selection)
5. [Implementation Recommendations](#implementation-recommendations)

---

## Overview

### Current State

The application currently loads secrets directly from environment variables:
- `OPENROUTER_API_KEY` - OpenRouter API access
- `ANTHROPIC_API_KEY` - Anthropic Claude API access
- `OPENAI_API_KEY` - OpenAI API access
- `OLLAMA_BASE_URL` - Local Ollama server (no secret required)

This approach has security limitations:
- Secrets are visible in process environment (readable via `/proc`)
- No encryption at rest
- No access auditing
- No rotation mechanism
- Difficult to manage across environments

### Goals

1. **Confidentiality**: Secrets protected at rest and in transit
2. **Integrity**: Detect unauthorized modifications
3. **Availability**: Reliable access during application runtime
4. **Auditability**: Track who accessed what and when
5. **Operability**: Simple developer experience, easy rotation

---

## Architecture Document

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application Layer                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Game Server  │    │  Experiment  │    │   Scripts    │      │
│  │  (WebSocket) │    │    Runner    │    │ (CLI tools)  │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └───────────────────┼───────────────────┘               │
│                             │                                    │
│                     ┌───────▼───────┐                           │
│                     │  Secrets API  │                           │
│                     │    Layer      │                           │
│                     └───────┬───────┘                           │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              │
┌─────────────────────────────┼────────────────────────────────────┐
│                     Secrets Layer                                 │
├─────────────────────────────┼────────────────────────────────────┤
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────┐        │
│  │                  Key Service                         │        │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │        │
│  │  │   Decrypt   │  │   Cache     │  │   Audit     │  │        │
│  │  │   Engine    │  │  (in-mem)   │  │   Logger    │  │        │
│  │  └──────┬──────┘  └─────────────┘  └─────────────┘  │        │
│  └─────────┼────────────────────────────────────────────┘        │
│            │                                                     │
│  ┌─────────▼─────────┐                                          │
│  │   Secret Store    │                                          │
│  │  ┌─────────────┐  │                                          │
│  │  │ Encrypted   │  │     ┌─────────────────────┐              │
│  │  │ Secrets     │◄─┼─────│  Master Key Source  │              │
│  │  │ (.sops.yaml)│  │     │  (age key file or   │              │
│  │  └─────────────┘  │     │   env variable)     │              │
│  └───────────────────┘     └─────────────────────┘              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow: Secret Read Operation

```
1. Application Start
   ├─► SecretsAPI.init()
   │
2. Load Master Key
   │   ├─► Check AGE_SECRET_KEY env var
   │   ├─► OR read from ~/.config/sops/age/keys.txt
   │   └─► Fail if neither available
   │
3. Decrypt Secrets File
   │   ├─► Read secrets.enc.yaml (SOPS-encrypted)
   │   ├─► Decrypt using age key
   │   └─► Parse YAML structure
   │
4. Cache in Memory
   │   ├─► Store decrypted values in process memory
   │   └─► Clear file buffers (minimize exposure window)
   │
5. Application Runtime
   │   ├─► secrets.get("OPENAI_API_KEY") → returns cached value
   │   └─► Audit log: "secret accessed: OPENAI_API_KEY"
   │
6. Application Shutdown
       └─► Clear cached secrets from memory
```

### Data Flow: Secret Write Operation (Admin Only)

```
1. Developer creates/updates secret
   ├─► Edit secrets.yaml (plaintext, local only)
   │
2. Encrypt with SOPS
   │   ├─► sops --encrypt secrets.yaml > secrets.enc.yaml
   │   └─► Encrypted file safe to commit
   │
3. Commit and Push
   │   ├─► secrets.enc.yaml committed to repo
   │   └─► Plaintext secrets.yaml is gitignored
   │
4. Deploy
       └─► Application loads encrypted file at runtime
```

### Key Hierarchy Design

```
                    ┌─────────────────────┐
                    │     Master Key      │
                    │  (age private key)  │
                    │                     │
                    │  Storage Options:   │
                    │  • AGE_SECRET_KEY   │
                    │  • keys.txt file    │
                    │  • Hardware token   │
                    └──────────┬──────────┘
                               │
                               │ Decrypts
                               ▼
                    ┌─────────────────────┐
                    │   Data Encryption   │
                    │       Keys          │
                    │                     │
                    │  Per-file keys      │
                    │  managed by SOPS    │
                    └──────────┬──────────┘
                               │
                               │ Protects
                               ▼
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ API Keys      │    │ Database      │    │ Service       │
│               │    │ Credentials   │    │ Tokens        │
│ • OpenRouter  │    │ (future)      │    │ (future)      │
│ • Anthropic   │    │               │    │               │
│ • OpenAI      │    │               │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## Threat Model

### Asset Inventory

| Asset | Description | Sensitivity | Usage Location |
|-------|-------------|-------------|----------------|
| `OPENROUTER_API_KEY` | OpenRouter API access | HIGH | Server, scripts |
| `ANTHROPIC_API_KEY` | Anthropic Claude API | HIGH | Server, scripts |
| `OPENAI_API_KEY` | OpenAI API access | HIGH | Server, scripts |
| Master Key (age) | Decrypts all secrets | CRITICAL | Deploy systems |
| Encrypted secrets file | Contains all secrets | MEDIUM | Git repository |

### STRIDE Analysis

#### Spoofing

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| S1 | Attacker impersonates authorized user to access secrets | Medium | High | Use file permissions; require key file access |
| S2 | Stolen API key used to impersonate application | Medium | High | Monitor API usage; implement rate limiting |
| S3 | Forged decryption request | Low | High | SOPS verifies key authenticity |

#### Tampering

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| T1 | Attacker modifies encrypted secrets file | Low | Medium | Git history provides integrity; SOPS MAC verification |
| T2 | Attacker injects malicious values during decryption | Low | High | SOPS authenticated encryption (AEAD) |
| T3 | Memory tampering of cached secrets | Low | High | Use secure memory practices; minimize cache lifetime |

#### Repudiation

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| R1 | Unauthorized secret access without trace | Medium | Medium | Implement audit logging for all access |
| R2 | Secret modification without attribution | Low | Medium | Git commit history; signed commits |

#### Information Disclosure

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| I1 | Secrets exposed in process environment | High | High | Don't use env vars for sensitive secrets |
| I2 | Secrets logged to stdout/files | Medium | High | Redact secrets in logs; no debug logging of values |
| I3 | Secrets in error messages | Medium | Medium | Sanitize error outputs |
| I4 | Memory dump exposes secrets | Low | High | Clear secrets on shutdown; use secure memory |
| I5 | Secrets exposed via /proc filesystem | Medium | High | Use in-memory decryption, not env vars |
| I6 | Encrypted file brute-forced | Very Low | Critical | age uses strong encryption (ChaCha20-Poly1305) |

#### Denial of Service

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| D1 | Key file deleted/corrupted | Low | High | Backup key file; document recovery |
| D2 | Encrypted secrets file corrupted | Low | Medium | Git provides history/recovery |
| D3 | API key revoked by provider | Low | High | Monitor key validity; have backup keys |

#### Elevation of Privilege

| Threat | Description | Likelihood | Impact | Mitigation |
|--------|-------------|------------|--------|------------|
| E1 | Unprivileged user gains key file access | Medium | Critical | Restrict file permissions (600) |
| E2 | Container escape exposes host secrets | Low | Critical | Use separate key per environment |
| E3 | Dependency compromise injects malicious code | Low | Critical | Pin dependencies; audit updates |

### Attack Vectors

#### 1. Compromised Host

**Scenario**: Attacker gains shell access to server running the application.

**Current Risk**: HIGH
- Environment variables readable via `/proc/<pid>/environ`
- Process memory can be dumped
- File system access exposes any stored secrets

**Mitigations**:
- Secrets decrypted only at startup, not stored in env
- In-memory cache cleared on shutdown
- Key file stored with 600 permissions
- Consider hardware security modules for production

#### 2. Insider Threat

**Scenario**: Malicious or compromised team member with repository access.

**Current Risk**: MEDIUM
- Encrypted secrets file is safe to commit
- Master key access is the control point

**Mitigations**:
- Master key distributed only to authorized systems
- Audit log tracks access patterns
- Key rotation capability
- Principle of least privilege for key access

#### 3. Supply Chain Attack

**Scenario**: Malicious code injected via compromised dependency.

**Current Risk**: MEDIUM
- Dependencies could exfiltrate secrets from memory
- Build-time attacks could capture plaintext

**Mitigations**:
- Pin dependency versions (package-lock.json)
- Regular dependency audits (`npm audit`)
- Use trusted, well-maintained libraries only
- Consider runtime integrity monitoring

#### 4. Git Repository Compromise

**Scenario**: Attacker gains access to git repository.

**Current Risk**: LOW (with encryption)
- Encrypted secrets file appears as noise
- Cannot be decrypted without master key

**Mitigations**:
- Never commit plaintext secrets (gitignore)
- Use pre-commit hooks to detect plaintext secrets
- Strong encryption via age/SOPS

### OWASP Top 10 Coverage

| OWASP Item | Relevance | Coverage |
|------------|-----------|----------|
| A01:2021 Broken Access Control | High | Key file permissions, API scoping |
| A02:2021 Cryptographic Failures | High | age encryption, SOPS authenticated encryption |
| A03:2021 Injection | Low | N/A for secrets management |
| A04:2021 Insecure Design | Medium | Defense in depth, key hierarchy |
| A05:2021 Security Misconfiguration | High | Clear setup docs, sensible defaults |
| A06:2021 Vulnerable Components | Medium | Minimal dependencies, audit process |
| A07:2021 Auth Failures | Medium | Key-based authentication only |
| A08:2021 Software Integrity | Medium | Dependency pinning, SOPS integrity |
| A09:2021 Logging Failures | Medium | Audit logging for access |
| A10:2021 SSRF | Low | N/A for secrets management |

---

## Technology Selection

### Evaluation Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Security | 30% | Encryption strength, key management, audit capability |
| Complexity | 25% | Setup time, learning curve, maintenance burden |
| Cost | 20% | Licensing, infrastructure, operational costs |
| Ops Burden | 25% | Day-to-day operations, rotation, recovery |

### Candidates

#### 1. age + SOPS

**Description**: File-based encryption using age for keys and SOPS for structured secret management.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Security | 4/5 | Modern encryption (X25519, ChaCha20), no key escrow |
| Complexity | 5/5 | Simple CLI tools, easy to understand |
| Cost | 5/5 | Free, open source |
| Ops Burden | 4/5 | Manual rotation, file-based backup |

**Pros**:
- Simple, Unix-philosophy tooling
- Works entirely offline
- No external service dependencies
- Encrypted files can be committed to git
- SOPS preserves YAML/JSON structure

**Cons**:
- No built-in key rotation
- Manual key distribution
- No centralized audit (must implement)
- No dynamic secrets

#### 2. HashiCorp Vault

**Description**: Full-featured secrets management platform with API access.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Security | 5/5 | HSM support, dynamic secrets, detailed audit |
| Complexity | 2/5 | Significant setup, requires infrastructure |
| Cost | 3/5 | Free tier; enterprise features paid |
| Ops Burden | 2/5 | Requires running service, HA considerations |

**Pros**:
- Dynamic secret generation
- Detailed audit logging
- Secret leasing and automatic rotation
- Policy-based access control
- Multiple auth methods

**Cons**:
- Requires running infrastructure
- Complexity overkill for small projects
- Learning curve for operators
- Network dependency at runtime

#### 3. AWS Secrets Manager

**Description**: Managed secrets service in AWS cloud.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Security | 5/5 | AWS KMS integration, automatic rotation |
| Complexity | 3/5 | AWS knowledge required, IAM setup |
| Cost | 2/5 | $0.40/secret/month + API calls |
| Ops Burden | 4/5 | Managed service, no infrastructure |

**Pros**:
- Fully managed, no infrastructure
- Automatic rotation support
- Tight AWS integration
- Detailed audit via CloudTrail

**Cons**:
- AWS vendor lock-in
- Costs scale with secrets count
- Requires internet/AWS connectivity
- IAM complexity for fine-grained access

#### 4. 1Password/Doppler (SaaS)

**Description**: Developer-focused SaaS secrets management.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Security | 4/5 | End-to-end encryption, SOC2 certified |
| Complexity | 4/5 | Easy setup, good CLI |
| Cost | 2/5 | Per-seat pricing, adds up for teams |
| Ops Burden | 5/5 | Fully managed, excellent UX |

**Pros**:
- Excellent developer experience
- Easy team collaboration
- Environment-specific configs
- No infrastructure to manage

**Cons**:
- SaaS dependency
- Per-user pricing
- Data leaves your control
- Internet required at runtime

### Recommendation

**Primary: age + SOPS**

For Agents of Treachery, we recommend **age + SOPS** because:

1. **Right-sized complexity**: The project has 3-4 API keys. Full secrets management platforms are overkill.

2. **Developer experience**: Simple CLI tools that work locally without network dependencies.

3. **Cost**: Zero cost, open source tools.

4. **Git-friendly**: Encrypted secrets can be committed alongside code, versioned together.

5. **Offline operation**: Works entirely offline, important for local development.

6. **Security**: age uses modern cryptography (X25519 + ChaCha20-Poly1305), no known weaknesses.

**Trade-offs accepted**:
- Manual key rotation (acceptable for low secret count)
- Self-managed audit logging (implement in application)
- No dynamic secrets (not needed for API keys)

**When to reconsider**:
- Secrets count exceeds 20
- Need automatic rotation
- Multi-tenant access control required
- Regulatory compliance requires managed solution

---

## Implementation Recommendations

### Directory Structure

```
project/
├── secrets/
│   ├── secrets.enc.yaml    # Encrypted (committed)
│   ├── secrets.yaml        # Plaintext (gitignored)
│   └── .sops.yaml          # SOPS configuration
├── src/
│   └── secrets/
│       ├── index.ts        # Secrets API
│       ├── loader.ts       # SOPS/age integration
│       └── audit.ts        # Access logging
└── .gitignore              # Excludes plaintext secrets
```

### Setup Commands

```bash
# Install age
brew install age  # macOS
# apt install age  # Debian/Ubuntu

# Install SOPS
brew install sops

# Generate key pair
age-keygen -o ~/.config/sops/age/keys.txt

# Get public key for .sops.yaml
age-keygen -y ~/.config/sops/age/keys.txt
# Outputs: age1xxxxxxxxx...

# Create .sops.yaml
cat > secrets/.sops.yaml << EOF
creation_rules:
  - path_regex: \.yaml$
    age: >-
      age1xxxxxxxxx...
EOF

# Encrypt secrets
sops --encrypt secrets/secrets.yaml > secrets/secrets.enc.yaml
```

### API Design

```typescript
// src/secrets/index.ts
interface SecretsAPI {
  /**
   * Initialize secrets from encrypted file.
   * Call once at application startup.
   */
  init(): Promise<void>;

  /**
   * Get a secret value by key.
   * Logs access for audit purposes.
   */
  get(key: string): string | undefined;

  /**
   * Check if a secret exists.
   */
  has(key: string): boolean;

  /**
   * Clear cached secrets.
   * Call on application shutdown.
   */
  clear(): void;
}
```

### Migration Path

1. **Phase 1**: Create encrypted secrets file, implement loader
2. **Phase 2**: Update application to use secrets API
3. **Phase 3**: Remove environment variable fallbacks
4. **Phase 4**: Add audit logging
5. **Phase 5**: Document key management procedures

### Security Checklist

- [ ] Key file permissions set to 600
- [ ] Plaintext secrets.yaml is gitignored
- [ ] Pre-commit hook detects plaintext secrets
- [ ] Secrets never logged (even at debug level)
- [ ] Memory cleared on application shutdown
- [ ] Key backup procedure documented
- [ ] Key rotation procedure documented
- [ ] Audit log captures all access

---

## Appendix

### age Key File Format

```
# created: 2026-02-05T00:00:00Z
# public key: age1xxxxxxxxx...
AGE-SECRET-KEY-1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### SOPS Encrypted File Example

```yaml
openrouter_api_key: ENC[AES256_GCM,data:...,iv:...,tag:...,type:str]
anthropic_api_key: ENC[AES256_GCM,data:...,iv:...,tag:...,type:str]
openai_api_key: ENC[AES256_GCM,data:...,iv:...,tag:...,type:str]
sops:
    kms: []
    gcp_kms: []
    azure_kv: []
    hc_vault: []
    age:
        - recipient: age1xxxxxxxxx...
          enc: |
            -----BEGIN AGE ENCRYPTED FILE-----
            ...
            -----END AGE ENCRYPTED FILE-----
    lastmodified: "2026-02-05T00:00:00Z"
    mac: ENC[AES256_GCM,data:...,iv:...,tag:...,type:str]
    version: 3.7.3
```

### References

- [age encryption tool](https://github.com/FiloSottile/age)
- [SOPS - Secrets OPerationS](https://github.com/getsops/sops)
- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [STRIDE Threat Model](https://docs.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)
