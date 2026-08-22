import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DriverShift } from "@/types/domain";

/**
 * S2-C: 기사 운행시작/운행종료 + 참고용 최근 위치. 배송 상태(order_shipments.
 * delivery_status)는 절대 건드리지 않는다 — 기사 배정 시점에 이미 배송중으로
 * 바뀌어 있고, 이 레코드는 그 위에 얹는 별도의 운영 기록일 뿐이다.
 */
async function findByDriverAndDate(driverId: string, shiftDate: string): Promise<DriverShift | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("driver_shifts")
    .select("*")
    .eq("driver_id", driverId)
    .eq("shift_date", shiftDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const driverShiftsRepository = {
  findByDriverAndDate,

  /** 운행시작 — 오늘 행이 없으면 만들고, 있으면 started_at만 채운다(이미 시작했으면 그대로 둔다). */
  async startShift(driverId: string, shiftDate: string): Promise<DriverShift> {
    const existing = await findByDriverAndDate(driverId, shiftDate);
    if (existing?.started_at) return existing;

    const { data, error } = await getSupabaseAdmin()
      .from("driver_shifts")
      .upsert({ driver_id: driverId, shift_date: shiftDate, started_at: new Date().toISOString() }, { onConflict: "driver_id,shift_date" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  /** 운행종료 — 오늘 행이 없으면(운행시작 없이 바로 종료 시도) 조용히 무시한다. */
  async endShift(driverId: string, shiftDate: string): Promise<DriverShift | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("driver_shifts")
      .update({ ended_at: new Date().toISOString() })
      .eq("driver_id", driverId)
      .eq("shift_date", shiftDate)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** 참고용 최근 위치 갱신 — 이력이 아니라 최신 값 하나만 덮어쓴다. 오늘 행이 없으면 만든다. */
  async updateLocation(driverId: string, shiftDate: string, latitude: number, longitude: number): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("driver_shifts")
      .upsert(
        {
          driver_id: driverId,
          shift_date: shiftDate,
          last_latitude: latitude,
          last_longitude: longitude,
          last_location_at: new Date().toISOString(),
        },
        { onConflict: "driver_id,shift_date" }
      );
    if (error) throw error;
  },

  /** 기사관리 설정 화면: 이 기사의 가장 최근(오늘이 아니어도) 위치 참고용 조회. */
  async findLatestLocation(driverId: string): Promise<DriverShift | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("driver_shifts")
      .select("*")
      .eq("driver_id", driverId)
      .not("last_location_at", "is", null)
      .order("shift_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Sprint4: 사장님 "전체 기사 위치" 지도 — 지정된 기사들의 오늘 운행 기록을 한 번에 조회한다. */
  async findTodayByDriverIds(driverIds: string[], shiftDate: string): Promise<DriverShift[]> {
    if (driverIds.length === 0) return [];
    const { data, error } = await getSupabaseAdmin()
      .from("driver_shifts")
      .select("*")
      .in("driver_id", driverIds)
      .eq("shift_date", shiftDate);
    if (error) throw error;
    return data ?? [];
  },
};
