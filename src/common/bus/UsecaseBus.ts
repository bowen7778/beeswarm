import { injectable, inject } from "inversify";
import { SYMBOLS } from "../di/symbols.js";
import { Container } from "inversify";

/**
 * Interface for all Usecases to implement.
 */
export interface IUsecase<TInput = any, TOutput = any> {
  execute(input: TInput): Promise<TOutput> | TOutput;
}

/**
 * Bus for resolving and executing Usecases.
 * Decouples callers (Facades/Services) from specific Usecase implementations.
 */
@injectable()
export class UsecaseBus {
  private container: Container | null = null;

  /**
   * Set the DI container for Usecase resolution.
   * This is typically called during container initialization.
   */
  public setContainer(container: Container): void {
    this.container = container;
  }

  /**
   * Resolve and execute a Usecase by its symbol.
   */
  public async execute<TInput = any, TOutput = any>(
    symbol: symbol,
    input: TInput
  ): Promise<TOutput> {
    if (!this.container) {
      throw new Error("[UsecaseBus] Container not initialized.");
    }

    const usecase = this.container.get<IUsecase<TInput, TOutput>>(symbol);
    if (!usecase || typeof usecase.execute !== "function") {
      throw new Error(`[UsecaseBus] Invalid Usecase for symbol: ${String(symbol)}`);
    }

    return await usecase.execute(input);
  }
}
