

# Fix Feedback Deletion and Cluster Cleanup

## Problems

### 1. Orphaned Clusters After Feedback Deletion
When feedback is deleted from the Inbox, the associated clusters in the Clusters view remain untouched. The `clusters` table has no relationship to `feedback` that would trigger cleanup. Clusters show stale `feedback_count` values and reference feedback that no longer exists.

### 2. Re-collection Returns Fewer Items
This is actually expected behavior, not a bug. Web search results are non-deterministic -- Google/Bing return different results each time. The deduplication (content_hash) correctly allows re-insertion of deleted items, but the search engine simply returns different pages on each run. However, we can improve the experience by clearly communicating this.

## Solution

### 1. Auto-cleanup orphaned clusters when feedback is deleted
Add logic to the bulk delete flow in `InboxView.tsx` that, after deleting feedback, checks if any clusters have zero remaining feedback items and removes them. Also recalculate `feedback_count` on remaining clusters.

### 2. Add a "Clean up clusters" step after deletion
After bulk-deleting feedback, query the clusters table and remove any cluster whose `cluster_id` no longer appears in any feedback row. Update `feedback_count` for remaining clusters.

## Technical Details

### File: `src/pages/InboxView.tsx`

Update the `bulkDelete` function to also clean up orphaned clusters after deleting feedback:

```typescript
const bulkDelete = async () => {
  setBulkUpdating(true);
  const ids = [...selectedIds];
  
  // Get the cluster_ids of feedback being deleted (for cleanup)
  const affectedClusterIds = feedback
    .filter(f => ids.includes(f.id) && f.cluster_id)
    .map(f => f.cluster_id!);
  
  // Delete the feedback
  const { error } = await supabase
    .from('feedback')
    .delete()
    .in('id', ids);

  if (error) {
    toast({ title: 'Bulk delete failed', description: error.message, variant: 'destructive' });
  } else {
    toast({ title: `Deleted ${ids.length} items` });
    setSelectedIds(new Set());
    
    // Clean up orphaned clusters
    if (affectedClusterIds.length > 0 && activeCompany) {
      const uniqueClusterIds = [...new Set(affectedClusterIds)];
      for (const clusterId of uniqueClusterIds) {
        // Count remaining feedback with this cluster_id
        const { count } = await supabase
          .from('feedback')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', activeCompany.id)
          .eq('cluster_id', clusterId);
        
        if (count === 0) {
          // No feedback left for this cluster - delete it
          await supabase.from('clusters').delete().eq('cluster_id', clusterId);
        } else {
          // Update the feedback_count
          await supabase.from('clusters')
            .update({ feedback_count: count })
            .eq('cluster_id', clusterId);
        }
      }
    }
    
    await fetchFeedback();
  }
  setBulkUpdating(false);
};
```

### Database: Add DELETE policy for clusters table

The `clusters` table currently has no DELETE RLS policy. We need to add one so the UI can remove orphaned clusters.

```sql
CREATE POLICY "Authenticated users can delete clusters"
ON public.clusters
FOR DELETE
USING (true);
```

## Files Changed

| File | Change |
|---|---|
| `src/pages/InboxView.tsx` | Update `bulkDelete` to clean up orphaned clusters after deletion |
| New migration | Add DELETE policy on clusters table |

## Expected Outcome

- Deleting feedback in the Inbox will automatically remove any clusters that have zero remaining feedback items
- Clusters with remaining feedback will have their `feedback_count` updated
- The Clusters view will stay in sync with the Inbox

