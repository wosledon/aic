#!/usr/bin/env node
/**
 * Mock-host smoke test for the Pi extension. This does not require the real Pi
 * binary: it exercises provider registration, header injection, approval gate,
 * command registration and telemetry through the extension's public entry.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const home = path.join(root, '.smoke-aic');

process.env.AIC_HOME = home;
process.env.AIC_PROJECT = 'payments-api';

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

const { default: activate } = await import('../dist/pi-extension.js');
const { flushTelemetry } = await import('../dist/core/telemetry.js');

const registrations = [];
const handlers = {};
const commands = {};
const notifications = [];

const pi = {
  registerProvider(id, config) {
    registrations.push({ id, config });
  },
  on(name, handler) {
    handlers[name] = handler;
  },
  registerCommand(name, options) {
    commands[name] = options;
  },
  appendEntry() {
    // session persistence is host-specific; no-op in this mock
  },
};

activate(pi);
await new Promise((resolve) => setTimeout(resolve, 2800));

assert(registrations.some((item) => item.id === 'aic-gateway'), 'provider aic-gateway should be registered');
const registration = [...registrations].reverse().find((item) => item.id === 'aic-gateway');
assert(registration.config.models.length > 0, 'provider should expose models from the gateway catalog');
assert(typeof registration.config.oauth?.login === 'function', 'provider should register device-code OAuth');
assert(typeof registration.config.oauth?.refreshToken === 'function', 'provider should register token refresh');
console.log(`✓ provider registered with ${registration.config.models.length} models`);

assert(typeof handlers.session_start === 'function', 'session_start handler should exist');
await handlers.session_start({}, { sessionId: 'pi_smoke_session', cwd: process.cwd(), model: { provider: 'aic-gateway' } });

const headerEvent = { headers: {} };
await handlers.before_provider_headers(headerEvent, { model: { provider: 'aic-gateway' } });
assert(headerEvent.headers['X-AIC-Client'] === 'pi', 'X-AIC-Client should be injected');
assert(headerEvent.headers['X-AIC-Project'] === 'payments-api', 'X-AIC-Project should be injected');
assert(Boolean(headerEvent.headers['X-AIC-Session']), 'X-AIC-Session should be injected');
assert(Boolean(headerEvent.headers['X-AIC-Device']), 'X-AIC-Device should be injected');
console.log('✓ Pi request headers injected only for aic-gateway');

const decision = await handlers.tool_call(
  { toolName: 'bash', args: { command: 'npm test' }, toolCallId: 'pi_smoke_call' },
  { model: { provider: 'aic-gateway' }, hasUI: false, ui: {} },
);
assert(decision?.block === true, 'no-UI approval should fail closed');
console.log('✓ no-UI tool approval blocked');

// Do not trigger agent_settled here: it starts an asynchronous flush and would
// race with the explicit flush assertion below. Real Pi hosts call it normally.
const flush = await flushTelemetry({ maxBatches: 5 });
assert(flush.accepted + flush.duplicates >= 1, 'Pi telemetry should be uploaded');
console.log(`✓ Pi telemetry uploaded (accepted=${flush.accepted}, duplicates=${flush.duplicates})`);

assert(typeof commands['aic-status']?.handler === 'function', '/aic-status command should be registered');
await commands['aic-status'].handler('', { ui: { notify: (message) => notifications.push(message) } });
assert(notifications.some((message) => message.includes('登录')), '/aic-status should report login state');
console.log('✓ /aic-status command responded');

console.log('\n✓ Pi extension host smoke test passed');