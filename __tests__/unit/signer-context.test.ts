import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AElf from 'aelf-sdk';
import { resolveSignerContext, SignerContextError } from '../../lib/signer-context';
import { setActiveWalletProfile } from '../../lib/wallet-context';

describe('signer context resolver', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    delete process.env.PORTKEY_SKILL_WALLET_CONTEXT_PATH;
    delete process.env.PORTKEY_WALLET_PASSWORD;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('resolves explicit signer from private key', () => {
    const wallet = AElf.wallet.createNewWallet();
    const result = resolveSignerContext({
      signerMode: 'explicit',
      privateKey: wallet.privateKey,
    });
    expect(result.provider).toBe('explicit');
    expect(result.identity.walletType).toBe('EOA');
  });

  test('resolves active EOA wallet context with password env', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'awaken-signer-context-'));
    const contextPath = join(tempDir, 'context.v1.json');
    const walletFile = join(tempDir, 'wallet.json');
    process.env.PORTKEY_SKILL_WALLET_CONTEXT_PATH = contextPath;

    const password = 'test-pass';
    const wallet = AElf.wallet.createNewWallet();
    writeFileSync(
      walletFile,
      JSON.stringify(
        {
          address: wallet.address,
          AESEncryptPrivateKey: AElf.wallet.AESEncrypt(wallet.privateKey, password),
        },
        null,
        2,
      ),
    );

    setActiveWalletProfile(
      {
        walletType: 'EOA',
        source: 'eoa-local',
        address: wallet.address,
        walletFile,
      },
      { skill: 'test', version: '0.0.0' },
    );

    process.env.PORTKEY_WALLET_PASSWORD = password;
    const resolved = resolveSignerContext({ signerMode: 'context' });
    expect(resolved.provider).toBe('context');
    expect(resolved.identity.walletType).toBe('EOA');
  });

  test('daemon mode reports not implemented', () => {
    expect(() => resolveSignerContext({ signerMode: 'daemon' })).toThrow(
      SignerContextError,
    );
  });
});
