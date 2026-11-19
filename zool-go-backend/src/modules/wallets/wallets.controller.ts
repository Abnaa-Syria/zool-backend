import type { BrokerOfficeStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { successResponse } from '../../shared/http/success-response';
import { walletsService } from './wallets.service';

export class WalletsController {
  async getBrokerWallet(req: Request, res: Response): Promise<Response> {
    const wallet = await walletsService.getOfficeWallet(req.brokerAuth!.officeId);
    return successResponse(res, {
      statusCode: 200,
      message: 'Wallet retrieved successfully',
      data: wallet,
      requestId: req.requestId,
    });
  }

  async listBrokerLedger(req: Request, res: Response): Promise<Response> {
    const result = await walletsService.listLedger(
      req.brokerAuth!.officeId,
      req.query as { page?: number; pageSize?: number },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Wallet ledger retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async listAdmin(req: Request, res: Response): Promise<Response> {
    const result = await walletsService.listAdmin(
      req.query as {
        page?: number;
        pageSize?: number;
        q?: string;
        officeStatus?: BrokerOfficeStatus;
        lowBalance?: boolean;
        sort?: 'balanceMinor' | 'updatedAt' | 'officeCode' | 'officeName';
        order?: 'asc' | 'desc';
      },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Wallets retrieved successfully',
      data: result.items,
      meta: result.meta,
      requestId: req.requestId,
    });
  }

  async getAdminWallet(req: Request, res: Response): Promise<Response> {
    const result = await walletsService.getAdminWalletView(
      req.params.officeId!,
      req.query as { page?: number; pageSize?: number },
    );
    return successResponse(res, {
      statusCode: 200,
      message: 'Broker wallet retrieved successfully',
      data: { wallet: result.wallet, ledger: result.ledger },
      meta: result.meta,
      requestId: req.requestId,
    });
  }
}

export const walletsController = new WalletsController();
