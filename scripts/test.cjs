// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(process.execPath,['--test','tests/proxy-recovery.test.cjs','tests/windows-recovery.test.cjs','tests/account-transport.test.cjs','tests/profile-migration.test.cjs','tests/login-flow.test.cjs','tests/branding.test.cjs','tests/brand-name-case.test.cjs','tests/core.test.cjs','tests/updates.test.cjs','tests/release-policy.test.cjs','tests/socks.test.cjs','tests/http2.test.cjs','tests/latency.test.cjs','tests/bootstrap-default.test.cjs'],{stdio:'inherit',env:{...process.env,NODE_EXTRA_CA_CERTS:path.resolve('tests/fixtures/localhost-cert.pem')}});
process.exit(result.status ?? 1);
