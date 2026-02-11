// ============================================================
// Core: Trade execution functions (no I/O, pure logic)
// ============================================================

import axios from 'axios';
import BigNumber from 'bignumber.js';
import {
  getNetworkConfig,
  getRouterAddress,
  getDeadline,
  DEFAULT_SLIPPAGE,
  CHANNEL_ID,
  SWAP_LABS_FEE_RATE,
} from '../../lib/config';
import {
  getWalletByPrivateKey,
  callSendMethod,
  callViewMethod,
  getTokenInfo,
  getAllowance,
  approveToken,
  getTxResult,
  timesDecimals,
  divDecimals,
} from '../../lib/aelf-client';
import type {
  NetworkConfig,
  SwapParams,
  SwapResult,
  LiquidityAddParams,
  LiquidityAddResult,
  LiquidityRemoveParams,
  LiquidityRemoveResult,
  ApproveParams,
  ApproveResult,
  TxResult,
} from '../../lib/types';

// ---- Helper: ensure approval ----

async function ensureApproval(
  config: NetworkConfig,
  wallet: any,
  symbol: string,
  spender: string,
  requiredAmount: string,
): Promise<void> {
  const owner = wallet.address;
  const currentAllowance = await getAllowance(config.rpcUrl, config.tokenContract, symbol, owner, spender);

  if (new BigNumber(currentAllowance).lt(requiredAmount)) {
    const approveAmount = new BigNumber(requiredAmount).times(10).toFixed(0);
    await approveToken(config, wallet, symbol, spender, approveAmount);
  }
}

// ---- executeSwap ----

export async function executeSwap(
  config: NetworkConfig,
  wallet: any,
  params: SwapParams,
): Promise<SwapResult> {
  const account = wallet.address;
  const slippage = params.slippage || DEFAULT_SLIPPAGE;

  // 1. Get token info
  const [tokenInInfo, tokenOutInfo] = await Promise.all([
    getTokenInfo(config.rpcUrl, config.tokenContract, params.symbolIn),
    getTokenInfo(config.rpcUrl, config.tokenContract, params.symbolOut),
  ]);

  const rawAmountIn = timesDecimals(params.amountIn, tokenInInfo.decimals).toFixed(0);

  // 2. Get best route
  const resp = await axios.get(`${config.apiBaseUrl}/api/app/route/best-swap-routes`, {
    params: {
      ChainId: config.chainId,
      symbolIn: params.symbolIn,
      symbolOut: params.symbolOut,
      routeType: 0,
      amountIn: rawAmountIn,
    },
  });

  const routeData = resp.data?.data;
  if (!routeData?.routes?.length) {
    throw new Error('No swap route found');
  }

  const bestRoute = routeData.routes[0];
  const rawAmountOut = bestRoute.amountOut;
  const slippageMultiplier = new BigNumber(1).minus(slippage);
  const amountOutMin = new BigNumber(rawAmountOut).times(slippageMultiplier).toFixed(0);

  // 3. Build swap tokens for multi-path (via SWAP_HOOK contract)
  const deadline = { seconds: getDeadline(), nanos: 0 };
  const swapTokens = bestRoute.distributions.map((dist: any) => ({
    amountIn: dist.amountIn,
    amountOutMin: new BigNumber(dist.amountOut).times(slippageMultiplier).toFixed(0),
    path: dist.tokens.map((t: any) => t.symbol),
    to: account,
    deadline,
    channel: CHANNEL_ID,
    feeRates: dist.feeRates.map((f: number) => Math.round(f * 10000)),
  }));

  // 4. Use SWAP_HOOK contract (not router) for swap execution
  const swapHookAddress = config.swapHookContract;

  // 5. Approve input token to swap hook contract
  await ensureApproval(config, wallet, params.symbolIn, swapHookAddress, rawAmountIn);

  // 6. Execute swap via swap hook contract
  const result = await callSendMethod(config.rpcUrl, swapHookAddress, 'SwapExactTokensForTokens', wallet, {
    swapTokens,
    labsFeeRate: SWAP_LABS_FEE_RATE,
  });

  const txId = result?.TransactionId || result?.transactionId;
  if (!txId) throw new Error('Swap failed: no transactionId returned');

  const txResult = await getTxResult(config.rpcUrl, txId);

  return {
    transactionId: txResult.transactionId,
    status: txResult.status,
    symbolIn: params.symbolIn,
    symbolOut: params.symbolOut,
    amountIn: params.amountIn,
    estimatedAmountOut: divDecimals(rawAmountOut, tokenOutInfo.decimals).toFixed(),
    minAmountOut: divDecimals(amountOutMin, tokenOutInfo.decimals).toFixed(),
    explorerUrl: `${config.explorerUrl}/tx/${txResult.transactionId}`,
  };
}

// ---- addLiquidity ----

export async function addLiquidity(
  config: NetworkConfig,
  wallet: any,
  params: LiquidityAddParams,
): Promise<LiquidityAddResult> {
  const account = wallet.address;
  const feeRate = params.feeRate || '0.3';
  const slippage = params.slippage || DEFAULT_SLIPPAGE;

  const [tokenAInfo, tokenBInfo] = await Promise.all([
    getTokenInfo(config.rpcUrl, config.tokenContract, params.tokenA),
    getTokenInfo(config.rpcUrl, config.tokenContract, params.tokenB),
  ]);

  const rawAmountA = timesDecimals(params.amountA, tokenAInfo.decimals).toFixed(0);
  const rawAmountB = timesDecimals(params.amountB, tokenBInfo.decimals).toFixed(0);

  const routerAddress = getRouterAddress(config, feeRate);
  const minRate = new BigNumber(1).minus(slippage);
  const amountAMin = new BigNumber(rawAmountA).times(minRate).toFixed(0);
  const amountBMin = new BigNumber(rawAmountB).times(minRate).toFixed(0);

  // Approve both tokens
  await Promise.all([
    ensureApproval(config, wallet, params.tokenA, routerAddress, rawAmountA),
    ensureApproval(config, wallet, params.tokenB, routerAddress, rawAmountB),
  ]);

  // Execute addLiquidity
  const result = await callSendMethod(config.rpcUrl, routerAddress, 'AddLiquidity', wallet, {
    symbolA: params.tokenA,
    symbolB: params.tokenB,
    amountADesired: rawAmountA,
    amountBDesired: rawAmountB,
    amountAMin,
    amountBMin,
    to: account,
    deadline: { seconds: getDeadline(), nanos: 0 },
    channel: CHANNEL_ID,
  });

  const txId = result?.TransactionId || result?.transactionId;
  if (!txId) throw new Error('Add liquidity failed: no transactionId');

  const txResult = await getTxResult(config.rpcUrl, txId);

  return {
    transactionId: txResult.transactionId,
    status: txResult.status,
    tokenA: params.tokenA,
    tokenB: params.tokenB,
    amountA: params.amountA,
    amountB: params.amountB,
    feeRate,
    explorerUrl: `${config.explorerUrl}/tx/${txResult.transactionId}`,
  };
}

// ---- removeLiquidity ----

export async function removeLiquidity(
  config: NetworkConfig,
  wallet: any,
  params: LiquidityRemoveParams,
): Promise<LiquidityRemoveResult> {
  const account = wallet.address;
  const feeRate = params.feeRate || '0.3';

  const LP_DECIMALS = 8;
  const rawLiquidity = timesDecimals(params.lpAmount, LP_DECIMALS).toFixed(0);
  const routerAddress = getRouterAddress(config, feeRate);

  const factoryAddress = config.factory[feeRate];
  if (!factoryAddress) throw new Error(`No factory for feeRate=${feeRate}`);

  // LP symbol: "ALP " + sorted token symbols joined by "-"
  const lpSymbol = `ALP ${[params.tokenA, params.tokenB].sort().join('-')}`;

  // Approve LP token on FACTORY contract (LP tokens live there, not token contract)
  const currentAllowance = await callViewMethod(config.rpcUrl, factoryAddress, 'GetAllowance', {
    symbol: lpSymbol,
    owner: account,
    spender: routerAddress,
  });
  if (new BigNumber(currentAllowance?.allowance ?? '0').lt(rawLiquidity)) {
    const approveResult = await callSendMethod(config.rpcUrl, factoryAddress, 'Approve', wallet, {
      symbol: lpSymbol,
      spender: routerAddress,
      amount: new BigNumber(rawLiquidity).times(10).toFixed(0),
    });
    const approveTxId = approveResult?.TransactionId || approveResult?.transactionId;
    if (approveTxId) await getTxResult(config.rpcUrl, approveTxId);
  }

  const result = await callSendMethod(config.rpcUrl, routerAddress, 'RemoveLiquidity', wallet, {
    symbolA: params.tokenA,
    symbolB: params.tokenB,
    amountAMin: '1',
    amountBMin: '1',
    liquidityRemove: rawLiquidity,
    to: account,
    deadline: { seconds: getDeadline(), nanos: 0 },
  });

  const txId = result?.TransactionId || result?.transactionId;
  if (!txId) throw new Error('Remove liquidity failed: no transactionId');

  const txResult = await getTxResult(config.rpcUrl, txId);

  return {
    transactionId: txResult.transactionId,
    status: txResult.status,
    tokenA: params.tokenA,
    tokenB: params.tokenB,
    lpAmount: params.lpAmount,
    explorerUrl: `${config.explorerUrl}/tx/${txResult.transactionId}`,
  };
}

// ---- approveTokenSpending ----

export async function approveTokenSpending(
  config: NetworkConfig,
  wallet: any,
  params: ApproveParams,
): Promise<ApproveResult> {
  const tokenInfo = await getTokenInfo(config.rpcUrl, config.tokenContract, params.symbol);
  const rawAmount = timesDecimals(params.amount, tokenInfo.decimals).toFixed(0);

  const txResult = await approveToken(config, wallet, params.symbol, params.spender, rawAmount);

  return {
    transactionId: txResult.transactionId,
    status: txResult.status,
    symbol: params.symbol,
    spender: params.spender,
    amount: params.amount,
    explorerUrl: `${config.explorerUrl}/tx/${txResult.transactionId}`,
  };
}
