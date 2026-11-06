import type { AgentReply, DaoState } from "./types";

export function detectInjection(text: string): string | null;
export function parsePrompt(text: string, state: DaoState): AgentReply;
export function moneyLabel(value: number): string;
export function formatUtcDate(value: number): string;
