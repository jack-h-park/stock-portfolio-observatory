# Private web access: intentional deployment constraint

The owner-operated private deployment intentionally permits the finance web hostname only from an explicit allowlist of approved owner devices on Tailscale. This applies to the **entire finance website**, including assets, tax history and evidence downloads. Normal browser access is supported; an SSH tunnel is not required for everyday use.

This restriction is an intended operating policy, not an application outage. A newly enrolled, re-enrolled, shared or other user's device is not automatically authorized. It may connect to the tailnet and still receive HTTP 403 from the finance gateway. Review its ownership and update the private allowlist before granting access. Remove retired or reassigned devices as part of the same ownership review.

## Enforcement boundary

- The reverse proxy for the finance hostname checks the actual connection's source IP against the reviewed device addresses. User-supplied forwarding headers do not establish authorization.
- The application remains bound to loopback. Trusted same-host administration and health checks remain possible; this network policy does not isolate local administrators or processes sharing the service account.
- The restriction is scoped to the finance site. Other sites sharing the gateway and HTTPS port keep their existing access rules. Tailnet membership and broad network grants alone are not proof of owner-only finance access.
- `FINANCE_MODE=private` selects private storage; it does **not** authenticate users or enforce this network policy. Public sample installations must not claim that this deployment restriction protects them automatically.
- Keep approved device identities, exact addresses, credentials and deployment manifests outside this public repository. The allowlist is reviewed deployment configuration, not a dynamic owner-login service.

## Operator verification and changes

Persist the site rule in the gateway's startup configuration and verify the effective running rule. A runtime-only change is incomplete because a restart or reload from an older file can replace it. Preserve the previous site configuration for rollback and protect concurrent configuration updates.

After a change, verify normal HTTPS access from an approved device, rejection of unapproved source addresses, loopback-only application binding and unchanged rules for other sites. Distinguish policy/matcher checks from an actual request made on another person's physical device. Do not restart or deploy the application merely to change the gateway access rule.

The finance website includes an optional English/Korean notice in its common page layout. After verifying the gateway restriction, set `FINANCE_ACCESS_NOTICE=owner-devices` on the private deployment to display it throughout the site. It is hidden in sample mode, when unset, and for unrecognized values. This setting labels an already enforced policy; it never creates a gateway rule, authenticates a user or enables writes. Do not enable the label on a deployment without the restriction. Installing this code and enabling the label are deployment/configuration steps requiring their own execution scope.

The notice states the following as a durable constraint rather than a temporary incident:

> **Intentional access restriction:** The finance website, including taxes and evidence, is available only from approved owner devices over Tailscale. Use the normal web URL; no SSH tunnel is required. New or re-enrolled devices require an access review. Other services retain their existing access rules.

Access approval does not enable tax-history writes, import financial records or prove settlement evidence complete. Those remain separate gates in the [tax-history workflow](tax-history.md) and [backup/recovery procedure](finance-state-backup-and-restore.md).
