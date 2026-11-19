import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export const WalletErrors = {
  insufficientBalance: (details: { balance: number; required: number }) =>
    new AppError({
      message: 'Insufficient wallet balance',
      statusCode: 409,
      code: ErrorCodes.INSUFFICIENT_BALANCE,
      details: { balanceMinor: details.balance, requiredMinor: details.required },
    }),
  walletNotFound: () => AppError.notFound('Wallet not found'),
};
