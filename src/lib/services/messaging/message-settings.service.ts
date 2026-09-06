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
/**
 * STEP15-F1 — 서비스 가입 상태. 기존 `enabled`(발송 마스터 스위치)와 의미가
 * 겹쳐서 분리했다. 서비스가 `enabled`여도 이벤트가 전부 OFF면 아무 것도 보내지
 * 않는다(2단 안전장치). `suspended`는 지금 UI에 노출하지 않지만 운영상 필요해질
 * 값이라 구조에서 막지 않는다.
 */
export type MessageServiceStatus = "disabled" | "pending" | "enabled" | "suspended";

export interface TenantMessageSettings {
  serviceStatus: MessageServiceStatus;
  /** @deprecated serviceStatus로 대체됐다. 기존 저장값을 읽을 때만 쓰인다. */
  enabled: boolean;
  /** 자동 발송 시 잔액에서 차감된다는 안내에 동의한 시각(ISO). 동의 없이는 활성화하지 않는다. */
  autoSendAgreedAt: string | null;
  /** 이벤트별 자동 발송 ON/OFF. */
  events: Record<MessageEventType, boolean>;
  /** 카카오 발신프로필(senderKey) 연결 상태 — 값 자체는 여기 저장하지 않는다. */
  senderProfileStatus: "none" | "pending" | "ready";
  /** 잔액 부족 시 발송 중지(안전장치). 기본 true. */
  stopOnInsufficientBalance: boolean;
}

const DEFAULTS: TenantMessageSettings = {
  serviceStatus: "disabled",
  enabled: false,
  autoSendAgreedAt: null,
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
  const merged: TenantMessageSettings = {
    ...DEFAULTS,
    ...stored,
    events: { ...DEFAULTS.events, ...(stored.events ?? {}) },
  };
  // 기존 저장값 호환 — serviceStatus가 없던 시절의 `enabled: true`는 사용 중으로 읽는다.
  if (!stored.serviceStatus) merged.serviceStatus = stored.enabled ? "enabled" : "disabled";
  return merged;
}

/** 발송 가능한 상태인지 — 서비스가 켜져 있고 그 이벤트도 켜져 있어야 한다. */
export function canSendEvent(settings: TenantMessageSettings, eventType: keyof TenantMessageSettings["events"]): boolean {
  return settings.serviceStatus === "enabled" && settings.events[eventType] === true;
}

export async function saveTenantMessageSettings(ownerUsername: string, settings: TenantMessageSettings): Promise<void> {
  await settingsRepository.set(settingsKeyFor(ownerUsername), settings);
}
