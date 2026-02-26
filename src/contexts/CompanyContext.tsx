import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Company {
  id: string;
  name: string;
  domain: string;
}

interface CompanyContextType {
  companies: Company[];
  activeCompany: Company | null;
  setActiveCompany: (id: string) => void;
  loading: boolean;
  refetchCompanies: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType>({
  companies: [],
  activeCompany: null,
  setActiveCompany: () => {},
  loading: true,
  refetchCompanies: async () => {},
});

export function useCompany() {
  return useContext(CompanyContext);
}

const STORAGE_KEY = 'feedbackflow_active_company';

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompany, setActiveCompanyState] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCompanies = async () => {
    if (!user) {
      setCompanies([]);
      setActiveCompanyState(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('companies')
      .select('id, name, domain')
      .eq('user_id', user.id)
      .order('created_at');
    const list = data || [];
    setCompanies(list);

    const stored = localStorage.getItem(STORAGE_KEY);
    const match = list.find((c) => c.id === stored);
    setActiveCompanyState(match || list[0] || null);
    setLoading(false);
  };

  useEffect(() => {
    fetchCompanies();
  }, [user]);

  const setActiveCompany = (id: string) => {
    const match = companies.find((c) => c.id === id);
    if (match) {
      setActiveCompanyState(match);
      localStorage.setItem(STORAGE_KEY, id);
    }
  };

  return (
    <CompanyContext.Provider value={{ companies, activeCompany, setActiveCompany, loading, refetchCompanies: fetchCompanies }}>
      {children}
    </CompanyContext.Provider>
  );
}
