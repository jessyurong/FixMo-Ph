import { useState } from "react";
import { 
  useListBackjobs, 
  useCreateBackjob, 
  useUpdateBackjobStatus,
  useDeleteBackjob,
  useListTechnicians,
  getListBackjobsQueryKey,
  type BackjobStatus,
} from "@/lib/offline-api";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight, ShieldAlert, Wrench } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { addDays, isBefore, parseISO } from "date-fns";

type StatusFilter = 'all' | BackjobStatus;

export default function BackjobsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  
  // Create API param properly - don't send 'all' to the API
  const apiParams = statusFilter === 'all' ? {} : { status: statusFilter };
  const { data: backjobs = [], isLoading } = useListBackjobs(apiParams);
  const { data: technicians = [] } = useListTechnicians();
  
  const createBackjob = useCreateBackjob();
  const updateBackjob = useUpdateBackjobStatus();
  const deleteBackjob = useDeleteBackjob();

  const [modalOpen, setModalOpen] = useState(false);
  
  const [formData, setFormData] = useState({
    customer: "",
    unit: "",
    technicianId: null as number | null,
    issue: "",
    originalRepairDate: new Date().toISOString().split('T')[0],
    cause: "warranty" as "warranty" | "human_error"
  });

  const isWithinWarranty = (dateStr: string) => {
    if (!dateStr) return false;
    const repairDate = parseISO(dateStr);
    const warrantyEnd = addDays(repairDate, 7);
    return isBefore(new Date(), warrantyEnd);
  };

  const handleSave = () => {
    if (!formData.customer || !formData.unit || !formData.technicianId || !formData.issue) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createBackjob.mutate({ data: {
      customer: formData.customer,
      unit: formData.unit,
      technicianId: formData.technicianId,
      issue: formData.issue,
      originalRepairDate: formData.originalRepairDate,
      cause: formData.cause
    }}, { 
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBackjobsQueryKey() });
        setModalOpen(false);
        setFormData({
          customer: "",
          unit: "",
          technicianId: null,
          issue: "",
          originalRepairDate: new Date().toISOString().split('T')[0],
          cause: "warranty"
        });
        toast({ title: "Backjob logged successfully" });
      }
    });
  };

  const handleStatusAdvance = (id: number, currentStatus: string) => {
    let nextStatus: BackjobStatus;
    if (currentStatus === 'pending') nextStatus = 'in_progress';
    else if (currentStatus === 'in_progress' || currentStatus === 'in-progress') nextStatus = 'done';
    else return;

    updateBackjob.mutate({ id, data: { status: nextStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBackjobsQueryKey() });
        toast({ title: "Status updated" });
      }
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this backjob entry?")) {
      deleteBackjob.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBackjobsQueryKey() });
          toast({ title: "Deleted successfully" });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Backjob Tracker</h1>
        
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="in_progress">In Progress</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <Button onClick={() => setModalOpen(true)} variant="destructive" className="gap-2">
          <ShieldAlert className="h-4 w-4" /> Log Backjob
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {isLoading ? (
          <div className="col-span-full text-center py-8">Loading...</div>
        ) : backjobs.length === 0 ? (
          <div className="col-span-full text-center py-8 text-muted-foreground">No backjobs found</div>
        ) : (
          backjobs.map((job) => (
            <Card key={job.id} className="flex flex-col bg-card overflow-hidden border-border hover:border-primary/50 transition-colors">
              <div className="p-4 flex-1">
                <div className="flex justify-between items-start mb-3">
                  <Badge variant={job.status === 'done' || job.status === 'completed' ? 'default' : (job.status === 'in_progress' || job.status === 'in-progress') ? 'secondary' : 'outline'}
                         className={job.status === 'done' || job.status === 'completed' ? 'bg-green-600 hover:bg-green-700' : (job.status === 'in_progress' || job.status === 'in-progress') ? 'bg-blue-600 text-white' : ''}>
                    {job.status.replace('_', ' ').toUpperCase()}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => job.id && handleDelete(job.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                
                <h3 className="font-bold text-lg leading-tight">{job.customer}</h3>
                <p className="text-sm font-medium text-muted-foreground mb-4">{job.unit}</p>
                
                <div className="bg-muted/30 rounded-md p-3 mb-4 space-y-2 text-sm">
                  <div>
                    <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground block mb-1">Issue reported:</span>
                    {String(job.issue || '')}
                  </div>
                  <div className="pt-2 mt-2 border-t border-border flex items-center text-muted-foreground">
                    <Wrench className="h-3 w-3 mr-1" />
                    <span className="text-xs">Original Tech: <span className="font-medium text-foreground">{String(job.technicianName || '')}</span></span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-auto">
                  {job.withinWarranty ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">Within Warranty</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">Out of Warranty</Badge>
                  )}
                  
                  <Badge variant="outline" className="text-xs">
                    {job.cause === 'human_error' ? 'Human Error' : 'Warranty/Defect'}
                  </Badge>
                </div>
              </div>
              
              <div className="p-3 bg-muted/20 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>Original: {formatDate(String(job.originalRepairDate || '')).split(',')[0]}</span>
                
                {job.status !== 'done' && job.status !== 'completed' && (
                  <Button size="sm" className="h-7 text-xs" onClick={() => job.id && handleStatusAdvance(job.id, job.status)}>
                    {job.status === 'pending' ? 'Start Repair' : 'Mark Done'} <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Backjob</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Name</Label>
                <Input value={formData.customer} onChange={e => setFormData({...formData, customer: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Device / Unit</Label>
                <Input value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Issue Description</Label>
              <Input value={formData.issue} onChange={e => setFormData({...formData, issue: e.target.value})} placeholder="What is wrong with the device?" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Original Technician</Label>
                <Select value={formData.technicianId?.toString() || ""} onValueChange={v => setFormData({...formData, technicianId: parseInt(v)})}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {technicians.map(t => t.id ? (
                      <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                    ) : null)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Original Repair Date</Label>
                <Input type="date" value={formData.originalRepairDate} onChange={e => setFormData({...formData, originalRepairDate: e.target.value})} />
                <div className="text-xs mt-1">
                  {formData.originalRepairDate && (
                    isWithinWarranty(formData.originalRepairDate) 
                      ? <span className="text-green-500 font-medium">✓ Within 7-day warranty</span>
                      : <span className="text-destructive font-medium">✗ Out of warranty</span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="space-y-2 pt-2 border-t">
              <Label>Cause</Label>
              <div className="flex gap-2">
                <Button 
                  variant={formData.cause === 'warranty' ? 'default' : 'outline'} 
                  className="flex-1"
                  onClick={() => setFormData({...formData, cause: 'warranty'})}
                >
                  Warranty / Part Defect
                </Button>
                <Button 
                  variant={formData.cause === 'human_error' ? 'destructive' : 'outline'} 
                  className="flex-1"
                  onClick={() => setFormData({...formData, cause: 'human_error'})}
                >
                  Human Error
                </Button>
              </div>
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createBackjob.isPending}>
              Save Backjob
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}