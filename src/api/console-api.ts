import { ConsoleAPI } from "../types/functions";

// Console API implementation
export class FunctionConsoleAPI implements ConsoleAPI {
  private logs: string[] = [];

  log(...args: any[]): void {
    const message = args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    this.logs.push(`[LOG] ${new Date().toISOString()}: ${message}`);
    console.log(`[FUNCTION LOG]`, ...args);
  }

  error(...args: any[]): void {
    const message = args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    this.logs.push(`[ERROR] ${new Date().toISOString()}: ${message}`);
    console.error(`[FUNCTION ERROR]`, ...args);
  }

  warn(...args: any[]): void {
    const message = args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    this.logs.push(`[WARN] ${new Date().toISOString()}: ${message}`);
    console.warn(`[FUNCTION WARN]`, ...args);
  }

  getLogs(): string[] {
    return [...this.logs];
  }
}
