import { useState } from "react";
import { 
  useListTechnicians, 
  useCreateTechnician, 
  useDeleteTechnician,
  getListTechniciansQueryKey
} from "@/lib/offline-api";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, UserCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function TechniciansPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: technicians = [], isLoading } = useListTechnicians();
  
  const createTechnician = useCreateTechnician();
  const deleteTechnician = useDeleteTechnician();

  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    role: "Senior Technician"
  });

  const handleSave = () => {
    if (!formData.name) { toast({ title: "Name is required", variant: "destructive" }); return; }
    
    createTechnician.mutate({ data: formData }, { 
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTechniciansQueryKey() });
        setModalOpen(false);
        setFormData({ name: "", role: "Senior Technician" });
        toast({ title: "Technician added successfully" });
      }
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to remove this technician?")) {
      deleteTechnician.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTechniciansQueryKey() });
          toast({ title: "Technician removed" });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Technicians</h1>
        <Button onClick={() => setModalOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Technician
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role/Specialty</TableHead>
                <TableHead className="text-center">Jobs Done</TableHead>
                <TableHead className="text-right">Total Sales Generated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : technicians.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">No technicians found</TableCell></TableRow>
              ) : (
                technicians.map((tech) => (
                  <TableRow key={tech.id}>
                    <TableCell>
                      <UserCircle className="h-8 w-8 text-muted-foreground" />
                    </TableCell>
                    <TableCell className="font-medium text-base">{tech.name}</TableCell>
                    <TableCell className="text-muted-foreground">{tech.role}</TableCell>
                    <TableCell className="text-center font-bold">{tech.jobsDone}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">{formatCurrency(tech.totalSales ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/20" onClick={() => handleDelete(tech.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Technician</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. John Doe" />
            </div>
            <div className="space-y-2">
              <Label>Role / Specialty</Label>
              <Input value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} placeholder="e.g. iPhone Specialist" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createTechnician.isPending}>
              Add Technician
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}