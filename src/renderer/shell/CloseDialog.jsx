import { CirclePause, CircleX, PanelBottomClose } from 'lucide-react';
import { Dialog } from '../components/Dialog.jsx';
import { api } from '../lib/api.js';
import { setCloseRequest, useApp } from '../state/app.js';
import { t } from '../strings/index.js';

export function CloseDialog() {
  const request = useApp((state) => state.closeRequest);
  const choose = (choice) => {
    setCloseRequest(null);
    api.app.respondClose(choice);
  };
  return (
    <Dialog
      open={Boolean(request)}
      title={t.app.closeTitle}
      text={request ? t.app.closeText(request.active) : ''}
      stacked
      onCancel={() => choose('stay')}
      actions={[
        { id: 'background', label: t.app.closeBackground, hint: t.app.closeBackgroundHint, icon: PanelBottomClose, onSelect: () => choose('background') },
        { id: 'pause', label: t.app.closePause, hint: t.app.closePauseHint, icon: CirclePause, variant: 'primary', autoFocus: true, onSelect: () => choose('pause') },
        { id: 'cancel', label: t.app.closeCancel, hint: t.app.closeCancelHint, icon: CircleX, variant: 'danger', onSelect: () => choose('cancel') }
      ]}
    />
  );
}
