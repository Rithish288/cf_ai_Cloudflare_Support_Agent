import { useEffect, useState } from "react";
import { Badge, Empty, Surface, Text } from "@cloudflare/kumo";

interface Ticket {
  id: string;
  customer_email: string;
  category: string;
  sentiment: string;
  urgency: string;
  status: string;
  transcript: string;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total: number;
  open: number;
  closed: number;
  pending: number;
  escalated: number;
}

export function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [statsRes, ticketsRes] = await Promise.all([
        fetch("/api/stats", { method: "GET" }),
        fetch("/api/tickets", { method: "GET" })
      ]);
      const statsData: Stats = await statsRes.json();
      const ticketsData: Ticket[] = await ticketsRes.json();
      setStats(statsData);
      setTickets(ticketsData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Text>Loading dashboard...</Text>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="text-lg font-bold mb-6">Ticket Dashboard</div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <Surface className="p-4">
            <Text size="sm" variant="secondary">
              Total Tickets
            </Text>
            <div className="text-lg font-bold">{stats?.total || 0}</div>
          </Surface>
          <Surface className="p-4">
            <Text size="sm" variant="secondary">
              Open
            </Text>
            <div className="text-lg font-bold text-green-600">
              {stats?.open || 0}
            </div>
          </Surface>
          <Surface className="p-4">
            <Text size="sm" variant="secondary">
              Closed
            </Text>
            <div className="text-lg font-bold text-gray-600">
              {stats?.closed || 0}
            </div>
          </Surface>
          <Surface className="p-4">
            <Text size="sm" variant="secondary">
              Pending
            </Text>
            <div className="text-lg font-bold text-yellow-600">
              {stats?.pending || 0}
            </div>
          </Surface>
          <Surface className="p-4">
            <Text size="sm" variant="secondary">
              Escalated
            </Text>
            <div className="text-lg font-bold text-red-600">
              {stats?.escalated || 0}
            </div>
          </Surface>
        </div>
      </div>

      <div>
        <div className="text-lg font-bold mb-4">Recent Tickets</div>
        {tickets.length === 0 ? (
          <Empty title="No tickets found" />
        ) : (
          <Surface className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">ID</th>
                  <th className="text-left p-2">Customer</th>
                  <th className="text-left p-2">Category</th>
                  <th className="text-left p-2">Sentiment</th>
                  <th className="text-left p-2">Urgency</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="border-b">
                    <td className="p-2 font-mono text-xs">
                      {ticket.id.slice(0, 8)}...
                    </td>
                    <td className="p-2">{ticket.customer_email}</td>
                    <td className="p-2">
                      <Badge variant="secondary">{ticket.category}</Badge>
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          ticket.sentiment === "positive"
                            ? "success"
                            : ticket.sentiment === "negative"
                              ? "error"
                              : "secondary"
                        }
                      >
                        {ticket.sentiment}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          ticket.urgency === "high"
                            ? "error"
                            : ticket.urgency === "medium"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {ticket.urgency}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          ticket.status === "open"
                            ? "success"
                            : ticket.status === "closed"
                              ? "neutral"
                              : ticket.status === "pending"
                                ? "warning"
                                : ticket.status === "escalated"
                                  ? "error"
                                  : "secondary"
                        }
                      >
                        {ticket.status}
                      </Badge>
                    </td>
                    <td className="p-2 text-sm">
                      {new Date(ticket.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        )}
      </div>
    </div>
  );
}
