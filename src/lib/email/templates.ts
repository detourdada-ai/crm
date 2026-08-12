// Dates are always computed here from real timestamps passed in by the
// caller (tenants.created_at / access_expires_at) — never hardcoded.
function formatKoreanDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월 ${String(d.getDate()).padStart(2, "0")}일`;
}

function formatKoreanDateTime(iso: string): string {
  const d = new Date(iso);
  const date = formatKoreanDate(iso);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function betaWelcomeEmail(startAtIso: string, endAtIso: string, appUrl: string): { subject: string; html: string } {
  const subject = "Ordify Beta가 시작되었습니다";
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #111;">
      <p>안녕하세요.</p>
      <p>Ordify Beta 가입이 완료되었습니다.</p>
      <p>지금부터 Ordify의 모든 기능을 Beta 기간 동안 무료로 이용하실 수 있습니다.</p>
      <p><strong>■ Beta 이용 기간</strong><br>${formatKoreanDate(startAtIso)} ~ ${formatKoreanDate(endAtIso)}</p>
      <p><strong>■ 이용 방법</strong><br>아래 버튼을 눌러 Ordify에 로그인해주세요.</p>
      <p><a href="${appUrl}/login" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Ordify 시작하기</a></p>
      <p>Beta 기간 동안 주문, 고객, 배송, 정산 등의 기능을 자유롭게 사용하실 수 있습니다.</p>
      <p>Beta 이용 종료 후에는 서비스 이용이 제한되며, 향후 정식 구독 서비스를 통해 계속 이용하실 수 있습니다.</p>
      <p style="color:#666; font-size:13px;">Ordify에서 보내드리는 안내 메일이 보이지 않는 경우 스팸함 또는 프로모션함을 확인해주세요.</p>
      <p>감사합니다.<br>Ordify</p>
    </div>
  `.trim();
  return { subject, html };
}

export function contactInquiryEmail(input: {
  name: string;
  email: string;
  category: string;
  message: string;
  submittedAtIso: string;
}): { subject: string; html: string } {
  const subject = `[Ordify 문의] ${input.category}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #111;">
      <p><strong>Ordify 고객 문의</strong></p>
      <p><strong>문의 유형</strong><br>${escapeHtml(input.category)}</p>
      <p><strong>이름</strong><br>${escapeHtml(input.name)}</p>
      <p><strong>이메일</strong><br>${escapeHtml(input.email)}</p>
      <p><strong>문의 내용</strong><br>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>
      <p><strong>접수 시간</strong><br>${formatKoreanDateTime(input.submittedAtIso)}</p>
    </div>
  `.trim();
  return { subject, html };
}

export function betaEndingEmail(endAtIso: string, appUrl: string): { subject: string; html: string } {
  const subject = "Ordify Beta 이용 기간이 종료되었습니다";
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #111;">
      <p>안녕하세요.</p>
      <p>Ordify Beta 이용 기간이 종료되었습니다.</p>
      <p>회원가입 시 시작된 무료 Beta 이용 기간이 종료되어 현재 Ordify 서비스 이용이 제한된 상태입니다.</p>
      <p><strong>■ Beta 종료일</strong><br>${formatKoreanDate(endAtIso)}</p>
      <p>Ordify를 계속 이용하시려면 정식 구독 서비스를 이용하실 수 있습니다.</p>
      <p><a href="${appUrl}/login" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Ordify 로그인</a></p>
      <p>정식 구독 서비스는 준비되는 대로 안내드리겠습니다.</p>
      <p style="color:#666; font-size:13px;">Ordify에서 보내드리는 안내 메일이 보이지 않는 경우 스팸함 또는 프로모션함을 확인해주세요.</p>
      <p>감사합니다.<br>Ordify</p>
    </div>
  `.trim();
  return { subject, html };
}
