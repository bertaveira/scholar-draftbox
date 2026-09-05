'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Image from 'next/image';
import { QrCode, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Dataset, profile } from '@/lib/conference';
import {
  getSaved,
  getStorageIssue,
  importProfile,
  initializeStorage,
} from '@/lib/storage';
import {
  decodeTransfer,
  isLoopback,
  transferSummary,
  transferUrl,
} from '@/lib/transfer';

export default function BookmarkTransfer({
  data,
  saved,
  showSend,
  exportSaved,
}: {
  data: Dataset | null;
  saved: string[];
  showSend: boolean;
  exportSaved: () => void;
}) {
  const [send, setSend] = useState(false),
    [address, setAddress] = useState(''),
    [qr, setQr] = useState(''),
    [link, setLink] = useState(''),
    [qrError, setQrError] = useState(''),
    [copied, setCopied] = useState(''),
    [incoming, setIncoming] = useState<string[] | null>(null),
    [incomingError, setIncomingError] = useState(''),
    [result, setResult] = useState('');
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      try {
        const ids = decodeTransfer(window.location.hash);
        if (!ids) {
          setIncoming(null);
          setIncomingError('');
        }
        if (ids) {
          setIncoming(ids);
          setIncomingError('');
          setResult('');
        }
      } catch (error) {
        setIncoming(null);
        setIncomingError((error as Error).message);
      }
    };
    void Promise.resolve().then(() => {
      if (cancelled) return;
      initializeStorage();
      read();
      const here = window.location;
      setAddress(here.origin);
      if (isLoopback(here.hostname)) {
        void fetch('/phone-preview.json', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((config) => {
            if (
              !cancelled &&
              config &&
              typeof config === 'object' &&
              'origin' in config &&
              typeof config.origin === 'string'
            )
              setAddress(config.origin);
          })
          .catch(() => {});
      }
    });
    window.addEventListener('hashchange', read);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', read);
    };
  }, []);
  useEffect(() => {
    if (!send) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setQr('');
      setLink('');
      setCopied('');
      setQrError('');
      try {
        const url = transferUrl(address, saved);
        const image = await QRCode.toDataURL(url, {
          errorCorrectionLevel: 'M',
          margin: 4,
          scale: 6,
        });
        if (!cancelled) {
          setLink(url);
          setQr(image);
        }
      } catch (error) {
        if (!cancelled) setQrError((error as Error).message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [send, address, saved]);
  function clearIncoming() {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
    setIncoming(null);
    setIncomingError('');
  }
  function confirmImport() {
    if (!incoming) return;
    const before = getSaved().length;
    try {
      const merged = importProfile(profile(incoming));
      const issue = getStorageIssue();
      setResult(
        `${merged.length - before} papers added. ${merged.length} saved in total.${issue ? ' ' + issue : ''}`,
      );
      clearIncoming();
    } catch (error) {
      setIncomingError((error as Error).message);
    }
  }
  const known = new Set(data?.papers.map((p) => p.id) || []);
  const summary = incoming ? transferSummary(incoming, saved, known) : null;
  return (
    <>
      {showSend && (
        <Button
          variant="outline"
          disabled={!saved.length}
          onClick={() => setSend(true)}
        >
          <QrCode size={16} /> Send to phone
        </Button>
      )}
      {result && <output className="transfer-result">{result}</output>}
      <Dialog open={send} onOpenChange={setSend}>
        <DialogContent className="bookmark-transfer-dialog">
          <DialogHeader>
            <DialogTitle>Send your pile to your phone.</DialogTitle>
            <DialogDescription>
              Scan with your phone’s camera, then confirm the import. Existing
              saves stay put.
            </DialogDescription>
          </DialogHeader>
          {qr ? (
            <figure className="transfer-qr">
              <Image
                unoptimized
                src={qr}
                width={360}
                height={360}
                alt={`QR code to import ${saved.length} saved papers`}
              />
              <figcaption>
                {saved.length} saved papers · one-time copy
              </figcaption>
            </figure>
          ) : (
            <output>{qrError || 'Preparing QR code…'}</output>
          )}
          {link && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(link)
                    .then(() => setCopied('Link copied.'))
                    .catch(() => setCopied('Select and copy the link below.'));
                  if (!navigator.clipboard)
                    setCopied('Select and copy the link below.');
                }}
              >
                <Copy size={16} /> Copy transfer link
              </Button>
              {copied === 'Select and copy the link below.' && (
                <label className="transfer-address">
                  Transfer link
                  <input
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
            </>
          )}
          {copied && <output>{copied}</output>}
          <Button variant="outline" onClick={exportSaved}>
            <Download size={16} /> Export JSON instead
          </Button>
          <p className="transfer-help">
            This copies bookmarks once; later changes don’t sync. Anyone with
            this code or link can import this selection.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(incoming || incomingError)}
        onOpenChange={(open) => {
          if (!open) clearIncoming();
        }}
      >
        <DialogContent className="bookmark-transfer-dialog">
          <DialogHeader>
            <DialogTitle>
              {incoming
                ? `Import ${incoming.length} saved papers?`
                : 'Could not read this transfer'}
            </DialogTitle>
            <DialogDescription>
              Your current bookmarks will be kept. Nothing changes until you
              import.
            </DialogDescription>
          </DialogHeader>
          {incomingError && <p role="alert">{incomingError}</p>}
          {incoming && summary && (
            <>
              <p>
                {summary.added} new · {summary.existing} already saved
              </p>
              {data ? (
                <>
                  <ul className="transfer-paper-preview">
                    {incoming.slice(0, 8).map((id) => (
                      <li key={id}>
                        {data.papers.find((p) => p.id === id)?.title ||
                          `Unavailable paper (${id})`}
                      </li>
                    ))}
                  </ul>
                  {incoming.length > 8 && (
                    <p>And {incoming.length - 8} more.</p>
                  )}
                  {summary.unavailable > 0 && (
                    <p>
                      {summary.unavailable} papers aren’t in this dataset. Their
                      bookmarks will be preserved.
                    </p>
                  )}
                </>
              ) : (
                <p>
                  Paper details are still unavailable. You can import the
                  bookmarks now.
                </p>
              )}
              <Button onClick={confirmImport}>Import saved papers</Button>
            </>
          )}
          <Button variant="outline" onClick={clearIncoming}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
