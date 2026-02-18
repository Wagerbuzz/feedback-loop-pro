import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export default function AddFeedbackDialog({ open, onClose, onAdded }: Props) {
  const [text, setText] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [source, setSource] = useState('Email');
  const [sentiment, setSentiment] = useState('Neutral');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data: existing } = await supabase
      .from('feedback')
      .select('feedback_id')
      .order('feedback_id', { ascending: false })
      .limit(1)
      .single();

    const lastNum = existing ? parseInt(existing.feedback_id.replace('FB-', '')) : 0;
    const newId = `FB-${String(lastNum + 1).padStart(3, '0')}`;

    const { error } = await supabase.from('feedback').insert({
      feedback_id: newId,
      text,
      customer_name: customerName,
      source,
      sentiment,
      status: 'New',
      timestamp: new Date().toISOString(),
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Feedback added', description: `${newId} created successfully` });
      setText('');
      setCustomerName('');
      onAdded();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Add Feedback</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div>
            <Label className="text-xs text-muted-foreground">Feedback Text</Label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              rows={3}
              placeholder="Enter the customer feedback…"
              className="mt-1.5 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Customer Name</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                placeholder="Jane Doe"
                className="mt-1.5 h-8 text-xs bg-muted border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="mt-1.5 h-8 text-xs bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {['Intercom', 'Slack', 'Email', 'Zendesk', 'In-App', 'Social'].map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Sentiment</Label>
            <Select value={sentiment} onValueChange={setSentiment}>
              <SelectTrigger className="mt-1.5 h-8 text-xs bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {['Positive', 'Negative', 'Neutral'].map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} className="text-xs h-7">Cancel</Button>
            <Button type="submit" size="sm" disabled={loading} className="text-xs h-7">
              {loading ? 'Adding…' : 'Add Feedback'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
