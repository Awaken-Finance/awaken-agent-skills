// ============================================================
// Unit Test: Core trade — error paths and edge cases
// ============================================================

import { describe, test, expect } from 'bun:test';
import { executeSwap, addLiquidity, removeLiquidity, approveTokenSpending } from '../../src/core/trade';
import { getNetworkConfig, getRouterAddress } from '../../lib/config';

const config = getNetworkConfig('mainnet');

// Create a mock wallet object (no real private key)
const fakeWallet = { address: 'FakeAddressForTesting123' };

describe('Core trade error paths', () => {
  // ---- executeSwap ----
  test('executeSwap throws for invalid token symbol', async () => {
    await expect(
      executeSwap(config, fakeWallet, {
        symbolIn: 'NONEXISTENT_TOKEN_XYZ',
        symbolOut: 'USDT',
        amountIn: '1',
      }),
    ).rejects.toThrow();
  });

  test('executeSwap throws when no route found', async () => {
    // Use tokens that won't have a route
    await expect(
      executeSwap(config, fakeWallet, {
        symbolIn: 'NONEXISTENT_A',
        symbolOut: 'NONEXISTENT_B',
        amountIn: '1',
      }),
    ).rejects.toThrow();
  });

  // ---- addLiquidity ----
  test('addLiquidity throws for invalid token symbol', async () => {
    await expect(
      addLiquidity(config, fakeWallet, {
        tokenA: 'NONEXISTENT_TOKEN_XYZ',
        tokenB: 'USDT',
        amountA: '1',
        amountB: '1',
      }),
    ).rejects.toThrow();
  });

  // ---- removeLiquidity ----
  test('removeLiquidity throws for unknown fee rate', async () => {
    // getRouterAddress is called before factory check, so the error comes from there
    await expect(
      removeLiquidity(config, fakeWallet, {
        tokenA: 'ELF',
        tokenB: 'USDT',
        lpAmount: '1',
        feeRate: '99.9', // no router/factory for this fee rate
      }),
    ).rejects.toThrow('No router for feeRate=99.9');
  });

  // ---- approveTokenSpending ----
  test('approveTokenSpending throws for invalid token', async () => {
    await expect(
      approveTokenSpending(config, fakeWallet, {
        symbol: 'NONEXISTENT_TOKEN_XYZ',
        spender: 'someContract',
        amount: '100',
      }),
    ).rejects.toThrow();
  });

  // ---- getRouterAddress ----
  test('getRouterAddress throws for invalid fee rate', () => {
    expect(() => getRouterAddress(config, '99.9')).toThrow(
      '[ERROR] No router for feeRate=99.9',
    );
  });

  test('getRouterAddress returns valid address for known fee rates', () => {
    const feeRates = ['0.05', '0.1', '0.3', '3', '5'];
    for (const rate of feeRates) {
      const addr = getRouterAddress(config, rate);
      expect(typeof addr).toBe('string');
      expect(addr.length).toBeGreaterThan(10);
    }
  });
});
