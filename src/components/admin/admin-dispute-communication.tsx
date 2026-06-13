import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNotifications } from "@/contexts/notification-context";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, User, Loader2 } from "lucide-react";

interface AdminDisputeCommunicationProps {
  escrowId: string;
  milestoneIndex: number;
  clientAddress: string;
  freelancerAddress: string;
  projectTitle: string;
}

export function AdminDisputeCommunication({
  escrowId,
  milestoneIndex,
  clientAddress,
  freelancerAddress,
  projectTitle,
}: AdminDisputeCommunicationProps) {
  const { addNotification } = useNotifications();
  const { toast } = useToast();
  const [messageToClient, setMessageToClient] = useState("");
  const [messageToFreelancer, setMessageToFreelancer] = useState("");
  const [sendingToClient, setSendingToClient] = useState(false);
  const [sendingToFreelancer, setSendingToFreelancer] = useState(false);

  const handleSendToClient = async () => {
    if (!messageToClient.trim()) {
      toast({
        title: "Message required",
        description: "Please enter a message to send",
        variant: "destructive",
      });
      return;
    }

    setSendingToClient(true);
    try {
      addNotification(
        {
          type: "dispute",
          title: `Admin Message: ${projectTitle}`,
          message: messageToClient,
          actionUrl: `/dashboard?escrow=${escrowId}`,
          data: { escrowId, milestoneIndex, from: "admin" },
        },
        [clientAddress]
      );

      toast({
        title: "Message sent to client",
        description: "The client will receive your message as a notification",
      });

      setMessageToClient("");
    } catch (error: any) {
      toast({
        title: "Failed to send message",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSendingToClient(false);
    }
  };

  const handleSendToFreelancer = async () => {
    if (!messageToFreelancer.trim()) {
      toast({
        title: "Message required",
        description: "Please enter a message to send",
        variant: "destructive",
      });
      return;
    }

    setSendingToFreelancer(true);
    try {
      addNotification(
        {
          type: "dispute",
          title: `Admin Message: ${projectTitle}`,
          message: messageToFreelancer,
          actionUrl: `/freelancer?escrow=${escrowId}`,
          data: { escrowId, milestoneIndex, from: "admin" },
        },
        [freelancerAddress]
      );

      toast({
        title: "Message sent to freelancer",
        description: "The freelancer will receive your message as a notification",
      });

      setMessageToFreelancer("");
    } catch (error: any) {
      toast({
        title: "Failed to send message",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSendingToFreelancer(false);
    }
  };

  const handleSendToBoth = async () => {
    const message = messageToClient || messageToFreelancer;
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please enter a message to send",
        variant: "destructive",
      });
      return;
    }

    setSendingToClient(true);
    setSendingToFreelancer(true);
    try {
      // Send to client
      addNotification(
        {
          type: "dispute",
          title: `Admin Message: ${projectTitle}`,
          message: message,
          actionUrl: `/dashboard?escrow=${escrowId}`,
          data: { escrowId, milestoneIndex, from: "admin" },
        },
        [clientAddress]
      );

      // Send to freelancer
      addNotification(
        {
          type: "dispute",
          title: `Admin Message: ${projectTitle}`,
          message: message,
          actionUrl: `/freelancer?escrow=${escrowId}`,
          data: { escrowId, milestoneIndex, from: "admin" },
        },
        [freelancerAddress]
      );

      toast({
        title: "Message sent to both parties",
        description: "Both client and freelancer will receive your message",
      });

      setMessageToClient("");
      setMessageToFreelancer("");
    } catch (error: any) {
      toast({
        title: "Failed to send message",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSendingToClient(false);
      setSendingToFreelancer(false);
    }
  };

  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Admin Communication
        </CardTitle>
        <CardDescription>
          Send private messages to client or freelancer regarding this dispute
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="client" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="client">To Client</TabsTrigger>
            <TabsTrigger value="freelancer">To Freelancer</TabsTrigger>
            <TabsTrigger value="both">To Both</TabsTrigger>
          </TabsList>

          {/* Message to Client */}
          <TabsContent value="client" className="space-y-4">
            <div className="bg-muted/50 p-3 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <User className="h-4 w-4" />
                <span className="text-sm font-medium">Client</span>
                <Badge variant="outline" className="ml-auto">
                  {clientAddress.slice(0, 6)}...{clientAddress.slice(-4)}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="messageToClient">Your Message</Label>
              <Textarea
                id="messageToClient"
                placeholder="Type your message to the client..."
                value={messageToClient}
                onChange={(e) => setMessageToClient(e.target.value)}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                The client will receive this as a notification
              </p>
            </div>

            <Button
              onClick={handleSendToClient}
              disabled={sendingToClient || !messageToClient.trim()}
              className="w-full"
            >
              {sendingToClient ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send to Client
                </>
              )}
            </Button>
          </TabsContent>

          {/* Message to Freelancer */}
          <TabsContent value="freelancer" className="space-y-4">
            <div className="bg-muted/50 p-3 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <User className="h-4 w-4" />
                <span className="text-sm font-medium">Freelancer</span>
                <Badge variant="outline" className="ml-auto">
                  {freelancerAddress.slice(0, 6)}...{freelancerAddress.slice(-4)}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="messageToFreelancer">Your Message</Label>
              <Textarea
                id="messageToFreelancer"
                placeholder="Type your message to the freelancer..."
                value={messageToFreelancer}
                onChange={(e) => setMessageToFreelancer(e.target.value)}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                The freelancer will receive this as a notification
              </p>
            </div>

            <Button
              onClick={handleSendToFreelancer}
              disabled={sendingToFreelancer || !messageToFreelancer.trim()}
              className="w-full"
            >
              {sendingToFreelancer ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send to Freelancer
                </>
              )}
            </Button>
          </TabsContent>

          {/* Message to Both */}
          <TabsContent value="both" className="space-y-4">
            <div className="bg-muted/50 p-3 rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span className="text-sm font-medium">Client</span>
                <Badge variant="outline" className="ml-auto">
                  {clientAddress.slice(0, 6)}...{clientAddress.slice(-4)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span className="text-sm font-medium">Freelancer</span>
                <Badge variant="outline" className="ml-auto">
                  {freelancerAddress.slice(0, 6)}...{freelancerAddress.slice(-4)}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="messageToBoth">Your Message</Label>
              <Textarea
                id="messageToBoth"
                placeholder="Type your message to both parties..."
                value={messageToClient || messageToFreelancer}
                onChange={(e) => {
                  setMessageToClient(e.target.value);
                  setMessageToFreelancer(e.target.value);
                }}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Both parties will receive this message as a notification
              </p>
            </div>

            <Button
              onClick={handleSendToBoth}
              disabled={sendingToClient || sendingToFreelancer || !(messageToClient || messageToFreelancer).trim()}
              className="w-full"
            >
              {sendingToClient || sendingToFreelancer ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send to Both Parties
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>

        <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-xs space-y-1">
          <p className="font-semibold text-blue-800 dark:text-blue-200">Communication Tips:</p>
          <ul className="list-disc list-inside space-y-0.5 text-blue-700 dark:text-blue-300">
            <li>Be professional and neutral in your communication</li>
            <li>Request additional evidence if needed</li>
            <li>Clarify any unclear points in the dispute</li>
            <li>Set expectations for resolution timeline</li>
            <li>Messages are sent as notifications to the parties</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
