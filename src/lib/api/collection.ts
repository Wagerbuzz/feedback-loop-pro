import { supabase } from '@/integrations/supabase/client';

export async function profileBrand(companyName: string, domain: string) {
  const { data, error } = await supabase.functions.invoke('brand-profile', {
    body: { company_name: companyName, domain },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function collectFeedback(companyId: string) {
  const { data, error } = await supabase.functions.invoke('collect-feedback', {
    body: { company_id: companyId },
  });
  if (error) throw new Error(error.message);
  return data;
}
