import "server-only";
import { settingsRepository } from "@/lib/repositories/settings.repository";
import type { MessageEventType } from "./types";

/**
 * STEP15-B — 테넌트별 메시지 설정.
 *
 * STEP A 조사대로 `app_settings(key, value)`의 계정별 네임스페이스 패턴을 그대로
 * 재사용한다(vip / column-view / import_column_mapping / import_order_scope 선례).
 * **이 설정을 위해 tenants에 새 컬럼을 만들지 않는다 — migration 불필요.**
 *
 * 기본값은 전부 OFF다. 사장님이 예상 단가와 잔액을 확인하고 명시적으로 켜기
 * 전에는 어떤 자동 발송도 일어나지 않는다(작업지시 §6-1).
 */
export interface TenantMessageSettings {
  /** 메시지 기능 자체 사용 여부. */
  enabled: boolean;
  /** 이벤트별 자동 발송 ON/OFF. */
  events: Record<MessageEventType, boolean>;
  /** 카카오 발신프로필(senderKey) 연결 상태 — 값 자체는 여기 저장하지 않는다. */
  senderProfileStatus: "none" | "pending" | "ready";
  /** 잔액 부족 시 발송 중지(안전장치). 기본 true. */
  stopOnInsufficientBalance: boolean;
}

const DEFAULTS: TenantMessageSettings = {
  enabled: false,
  events: { ORDER_RECEIVED: false, DRIVER_ASSIGNED: false, DELIVERY_COMPLETED: false },
  senderProfileStatus: "none",
  stopOnInsufficientBalance: true,
};

function settingsKeyFor(ownerUsername: string): string {
  return `message_settings:${ownerUsername}`;
}

export async function getTenantMessageSettings(ownerUsername: string): Promise<TenantMessageSettings> {
  const stored = await settingsRepository.get<Partial<TenantMessageSettings>>(settingsKeyFor(ownerUsername));
  if (!stored) return DEFAULTS;
  return {
    ...DEFAULTS,
    ...stored,
    events: { ...DEFAULTS.events, ...(stored.events ?? {}) },
  };
}

export async function saveTenantMessageSettings(ownerUsername: string, settings: TenantMessageSettings): Promise<void> {
  await settingsRepository.set(settingsKeyFor(ownerUsername), settings);
}
