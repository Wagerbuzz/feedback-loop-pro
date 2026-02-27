import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { profileBrand, collectFeedback } from '@/lib/api/collection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Building2, Globe, Plus, Loader2, Play, Clock, CheckCircle2, XCircle, CalendarClock, AlertCircle } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  domain: string;
  last_collected_at: string | null;
  brand_terms: any;
  product_terms: any;
  created_at: string;
  auto_collect_enabled: boolean;
  collection_frequency: string;
  collection_sources: string[] | null;
  reddit_subreddits: string[] | null;
}

interface CollectionRun {
  id: string;
  status: string;
  new_feedback_count: number;
  duplicates_skipped: number;
  clusters_updated: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

const SOURCE_OPTIONS = [
  { id: 'web', label: 'Web (G2, TrustRadius, blogs)', alwaysAvailable: true },
  { id: 'reddit', label: 'Reddit', alwaysAvailable: true },
  { id: 'twitter', label: 'Twitter / X', alwaysAvailable: false },
];

export default function CompanySetup() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [runs, setRuns] = useState<Record<string, CollectionRun[]>>({});
  const [loading, setLoading] = useState(true);
  const [addingCompany, setAddingCompany] = useState(false);
  const [collecting, setCollecting] = useState<string | null>(null);
  const [profiling, setProfiling] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [progress, setProgress] = useState(0);
  const [twitterConfigured, setTwitterConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    loadCompanies();
  }, [user]);

  const loadCompanies = async () => {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false });
    setCompanies((data as any[]) ?? []);
    setLoading(false);

    // Load runs for each company
    if (data && data.length > 0) {
      const { data: allRuns } = await supabase
        .from('collection_runs')
        .select('*')
        .in('company_id', data.map((c: any) => c.id))
        .order('started_at', { ascending: false })
        .limit(20);
      
      const grouped: Record<string, CollectionRun[]> = {};
      (allRuns as any[] ?? []).forEach((r: any) => {
        if (!grouped[r.company_id]) grouped[r.company_id] = [];
        if (grouped[r.company_id].length < 5) grouped[r.company_id].push(r);
      });
      setRuns(grouped);
    }
  };

  const handleAddCompany = async () => {
    if (!user || !newName.trim() || !newDomain.trim()) return;
    setAddingCompany(true);
    setProfiling(true);
    setProgress(10);

    try {
      toast.info(`Analyzing ${newName}...`);
      setProgress(20);
      const profileResult = await profileBrand(newName.trim(), newDomain.trim());
      setProgress(60);

      if (!profileResult?.success) {
        throw new Error(profileResult?.error || 'Brand profiling failed');
      }

      const profile = profileResult.data;

      const { data: inserted, error } = await supabase
        .from('companies')
        .insert({
          user_id: user.id,
          name: newName.trim(),
          domain: newDomain.trim(),
          brand_terms: profile.brand_terms,
          product_terms: profile.product_terms,
          feature_terms: profile.feature_terms,
          industry_type: profile.industry_type,
          persona_type: profile.persona_type,
          search_queries: profile.search_queries,
          reddit_subreddits: profile.reddit_subreddits || [],
          collection_sources: ['web', 'reddit'],
        })
        .select()
        .single();

      setProgress(100);

      if (error) throw new Error(error.message);

      toast.success(`${newName} added with ${profile.search_queries?.length || 0} search queries and ${profile.reddit_subreddits?.length || 0} subreddits`);
      setNewName('');
      setNewDomain('');
      setShowForm(false);
      await loadCompanies();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add company');
    } finally {
      setAddingCompany(false);
      setProfiling(false);
      setProgress(0);
    }
  };

  const handleCollect = async (company: Company) => {
    setCollecting(company.id);
    setProgress(10);
    toast.info(`Collecting feedback for ${company.name}... This may take a few minutes.`);

    try {
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 5, 90));
      }, 3000);

      const result = await collectFeedback(company.id);
      clearInterval(progressInterval);
      setProgress(100);

      if (result?.success) {
        const d = result.data;
        toast.success(
          `Found ${d.new_feedback_count} new feedback items, ${d.duplicates_skipped} duplicates skipped, ${d.clusters_updated} clusters updated`
        );
      } else {
        toast.error(result?.error || 'Collection failed');
      }

      await loadCompanies();
    } catch (err: any) {
      toast.error(err.message || 'Collection failed');
    } finally {
      setCollecting(null);
      setProgress(0);
    }
  };

  const toggleSource = async (company: Company, sourceId: string, enabled: boolean) => {
    const current = (company.collection_sources as string[]) || ['web', 'reddit'];
    const updated = enabled
      ? [...current, sourceId]
      : current.filter(s => s !== sourceId);
    
    await supabase.from('companies').update({ collection_sources: updated } as any).eq('id', company.id);
    setCompanies(cs => cs.map(c => c.id === company.id ? { ...c, collection_sources: updated } : c));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tracked Companies</h2>
          <p className="text-sm text-muted-foreground">
            Add a company to automatically collect and analyze customer feedback from across the web.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Company
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Company Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. MongoDB"
                className="h-8 text-sm"
                disabled={addingCompany}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Website Domain</label>
              <Input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="e.g. mongodb.com"
                className="h-8 text-sm"
                disabled={addingCompany}
              />
            </div>
          </div>
          {profiling && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Analyzing brand profile...</div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)} disabled={addingCompany}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddCompany} disabled={addingCompany || !newName.trim() || !newDomain.trim()}>
              {addingCompany ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Analyzing...</> : 'Add & Profile'}
            </Button>
          </div>
        </div>
      )}

      {/* Company cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No companies tracked yet. Add your first company to start collecting feedback.
        </div>
      ) : (
        <div className="space-y-3">
          {companies.map((company) => {
            const isCollecting = collecting === company.id;
            const companyRuns = runs[company.id] || [];
            const sources = (company.collection_sources as string[]) || ['web', 'reddit'];

            return (
              <div key={company.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center">
                      <Building2 className="w-4.5 h-4.5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{company.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Globe className="w-3 h-3" /> {company.domain}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {company.brand_terms && (
                      <Badge variant="secondary" className="text-[10px]">Profiled</Badge>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleCollect(company)}
                      disabled={isCollecting}
                      className="gap-1.5"
                    >
                      {isCollecting ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Collecting...</>
                      ) : (
                        <><Play className="w-3.5 h-3.5" /> Collect Now</>
                      )}
                    </Button>
                  </div>
                </div>

                {isCollecting && (
                  <div className="mt-3">
                    <Progress value={progress} className="h-1.5" />
                    <div className="text-xs text-muted-foreground mt-1">Searching web, Reddit, and more for feedback...</div>
                  </div>
                )}

                {/* Meta info */}
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  {company.last_collected_at && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last collected: {new Date(company.last_collected_at).toLocaleDateString()}
                    </div>
                  )}
                  {(company.brand_terms as any[])?.length > 0 && (
                    <div>{(company.brand_terms as any[]).length} brand terms</div>
                  )}
                  {(company.reddit_subreddits as any[])?.length > 0 && (
                    <div>{(company.reddit_subreddits as any[]).length} subreddits</div>
                  )}
                </div>

                {/* Collection sources */}
                <div className="mt-3 border-t border-border pt-3">
                  <div className="text-xs text-muted-foreground mb-2">Collection Sources</div>
                  <div className="flex flex-wrap gap-3">
                    {SOURCE_OPTIONS.map((src) => {
                      const isEnabled = sources.includes(src.id);
                      const isTwitter = src.id === 'twitter';

                      return (
                        <label key={src.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <Checkbox
                            checked={isEnabled}
                            onCheckedChange={(checked) => toggleSource(company, src.id, !!checked)}
                          />
                          <span>{src.label}</span>
                          {isTwitter && !src.alwaysAvailable && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <AlertCircle className="w-3 h-3" />
                              requires API keys
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Auto-collection settings */}
                <div className="mt-3 border-t border-border pt-3 flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={company.auto_collect_enabled}
                      onCheckedChange={async (checked) => {
                        await supabase.from('companies').update({ auto_collect_enabled: checked }).eq('id', company.id);
                        setCompanies(cs => cs.map(c => c.id === company.id ? { ...c, auto_collect_enabled: checked } : c));
                        toast.success(checked ? 'Auto-collection enabled' : 'Auto-collection disabled');
                      }}
                    />
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <CalendarClock className="w-3 h-3" /> Auto-collect
                    </label>
                  </div>
                  {company.auto_collect_enabled && (
                    <Select
                      value={company.collection_frequency}
                      onValueChange={async (value) => {
                        await supabase.from('companies').update({ collection_frequency: value }).eq('id', company.id);
                        setCompanies(cs => cs.map(c => c.id === company.id ? { ...c, collection_frequency: value } : c));
                        toast.success(`Frequency set to ${value}`);
                      }}
                    >
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Recent runs */}
                {companyRuns.length > 0 && (
                  <div className="mt-3 border-t border-border pt-2">
                    <div className="text-xs text-muted-foreground mb-1.5">Recent collections</div>
                    <div className="space-y-1">
                      {companyRuns.slice(0, 3).map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-xs">
                          {r.status === 'completed' ? (
                            <CheckCircle2 className="w-3 h-3 text-green-400" />
                          ) : r.status === 'failed' ? (
                            <XCircle className="w-3 h-3 text-red-400" />
                          ) : (
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                          )}
                          <span className="text-muted-foreground">
                            {new Date(r.started_at).toLocaleDateString()}
                          </span>
                          {r.status === 'completed' && (
                            <span>
                              {r.new_feedback_count} new · {r.duplicates_skipped} dupes · {r.clusters_updated} clusters
                            </span>
                          )}
                          {r.status === 'failed' && (
                            <span className="text-red-400">{r.error_message || 'Failed'}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
