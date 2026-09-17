import { Notice } from '../components/Feedback.jsx';
import { dismissNotice, useApp } from '../state/app.js';
import { t } from '../strings/index.js';

export function NoticeStack() {
  const notices = useApp((state) => state.notices);
  if (notices.length === 0) return null;
  return (
    <div className="notice-stack">
      {notices.map((notice) => (
        <Notice key={notice.id} tone={notice.tone} onDismiss={() => dismissNotice(notice.id)}>
          {t.app[notice.code] || notice.text || notice.code}
        </Notice>
      ))}
    </div>
  );
}
