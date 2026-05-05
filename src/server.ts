import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { TicketModule } from "./ticketModule";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import { DOC_ROUTES, NON_PRODUCT_DOCS } from "./docs-routes";

/**
 * The AI SDK's downloadAssets step runs `new URL(data)` on every file
 * part's string data. Data URIs parse as valid URLs, so it tries to
 * HTTP-fetch them and fails. Decode to Uint8Array so the SDK treats
 * them as inline data instead.
 */
function inlineDataUrls(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "file" || typeof part.data !== "string") return part;
        const match = part.data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return part;
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        return { ...part, data: bytes, mediaType: match[1] };
      })
    };
  });
}

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  onStart() {
    // Configure OAuth popup behavior for MCP servers that require authentication
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  private async fetchWithCache(url: string, ttl: number): Promise<string> {
    const cached = await this.env.DOCS_CACHE.get(url);
    if (cached) {
      return cached;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    let text = await response.text();

    // Clean up HTML content for non-product documents
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html') || text.includes('<html') || text.includes('<body')) {
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')   // remove scripts
        .replace(/<style[\s\S]*?<\/style>/gi, '')      // remove styles
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')          // remove navigation
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')    // remove footer
        .replace(/<header[\s\S]*?<\/header>/gi, '')    // remove header
        .replace(/<[^>]+>/g, ' ')                      // strip remaining tags
        .replace(/\s+/g, ' ')                          // collapse whitespace
        .trim();
    }

    await this.env.DOCS_CACHE.put(url, text, { expirationTtl: ttl });
    return text;
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });


    const result = streamText({

      model: workersai("@cf/meta/llama-4-scout-17b-16e-instruct"),
        // model: aigateway(openai.chat("gpt-4o")),
        system: `
      You are a Cloudflare customer support agent. Be professional, empathetic, and concise.

EVERY conversation, in order:
1. Greet by first name, acknowledge the issue
2. Call createTicket (category, urgency, sentiment, summary) — always, even if escalating
3. If escalation condition met → call escalateToHuman, else call fetchCloudflareDoc
4. Answer from doc content only — never from memory
5. Confirm resolution → close ticket or escalate

ESCALATE immediately if:
- Security, fraud, or account breach
- Specific billing dispute (wrong charge, refund request)
- Enterprise tier customer
- 3+ open tickets
- Customer asks for human
- Answer not found in docs after fetching
- Two failed resolution attempts
On escalation: warm handoff, confirm ticket number, give wait time: 24 hours.

fetchCloudflareDoc — productKey (fetches llms.txt index, then call again with pageUrl):
workers, d1, kv, agents, dns, ssl, waf, bots, turnstile, ddos-protection,
billing, fundamentals, support, stream, r2, workers-ai, workflows, pages,
queues, vectorize, ai-gateway, durable-objects, analytics, cache, images

fetchCloudflareDoc — directKey (fetches full page directly):
privacy, terms, trust, abuse, plans

CANNOT DO — always escalate:
Account access, refund processing, invoice details, account suspension, security incidents

TONE: Acknowledge emotion before solving. 2-4 sentences for simple issues.
Never invent product details, pricing, or policy. Never promise specific outcomes.`,
        // Prune old tool calls to save tokens on long conversations
        messages: pruneMessages({
          messages: inlineDataUrls(await convertToModelMessages(this.messages)),
          toolCalls: "before-last-2-messages"
        }),
        tools: {
          // Ticket management tools
          createTicket: tool({
            description: "Create a new support ticket for a customer issue",
            inputSchema: z.object({
              customer_email: z.string().describe("Customer email address"),
              category: z.string().describe("Issue category"),
              sentiment: z.string().describe("Sentiment analysis"),
              urgency: z.string().describe("Urgency level"),
              transcript: z.string().describe("Conversation transcript"),
              status: z.string().optional().describe("Ticket status, defaults to pending")
            }),
            execute: async (params) => TicketModule.createTicket(this.env, params)
          }),

          getTicket: tool({
            description: "Retrieve a ticket by its ID",
            inputSchema: z.object({
              id: z.string().describe("Ticket ID")
            }),
            execute: async ({ id }) => TicketModule.getTicket(this.env, id)
          }),

          updateTicketStatus: tool({
            description: "Update the status of a ticket",
            inputSchema: z.object({
              id: z.string().describe("Ticket ID"),
              status: z.string().describe("New status")
            }),
            execute: async ({ id, status }) => TicketModule.updateTicketStatus(this.env, id, status)
          }),

          appendTranscript: tool({
            description: "Append additional text to a ticket's transcript",
            inputSchema: z.object({
              id: z.string().describe("Ticket ID"),
              additionalTranscript: z.string().describe("Text to append")
            }),
            execute: async ({ id, additionalTranscript }) => TicketModule.appendTranscript(this.env, id, additionalTranscript)
          }),

          findRecentTickets: tool({
            description: "Find recent tickets for a customer",
            inputSchema: z.object({
              customer_email: z.string().describe("Customer email address"),
              limit: z.number().optional().describe("Maximum number of tickets, defaults to 10")
            }),
            execute: async ({ customer_email, limit }) => TicketModule.findRecentTickets(this.env, customer_email, limit)
          }),

          findCustomerHistory: tool({
            description: "Get full customer history (last 20 tickets)",
            inputSchema: z.object({
              customer_email: z.string().describe("Customer email address")
            }),
            execute: async ({ customer_email }) => TicketModule.findCustomerHistory(this.env, customer_email)
          }),

          identifyCustomer: tool({
            description: "Check if customer exists and get query count",
            inputSchema: z.object({
              customer_email: z.string().describe("Customer email address")
            }),
            execute: async ({ customer_email }) => TicketModule.identifyCustomer(this.env, customer_email)
          }),

          fetchCloudflareDocs: tool({
            description: `Fetch Cloudflare documentation to answer a customer question.
        
        For technical/product questions, pass a productKey from this list:
        ${Object.keys(DOC_ROUTES).join(', ')}

        For legal, pricing or abuse questions, pass a directKey from this list:
        ${Object.keys(NON_PRODUCT_DOCS).join(', ')}

        If you know the specific page URL already (from a previous index fetch),
        pass it as pageUrl to skip the index lookup and fetch the page directly.`,
            inputSchema: z.object({
              productKey: z.string().optional().describe("Product key for technical questions"),
              directKey: z.string().optional().describe("Direct key for legal, pricing, abuse questions"),
              pageUrl: z.string().optional().describe("Specific page URL if known")
            }),
            execute: async (params) => {
              let url: string | undefined;
              let ttl = 21600;
              if (params.pageUrl) {
                url = params.pageUrl;
              } else if (params.productKey) {
                url = DOC_ROUTES[params.productKey as keyof typeof DOC_ROUTES];
                if (!url) throw new Error(`Invalid productKey: ${params.productKey}`);
              } else if (params.directKey) {
                url = NON_PRODUCT_DOCS[params.directKey as keyof typeof NON_PRODUCT_DOCS];
                ttl
                if (!url) throw new Error(`Invalid directKey: ${params.directKey}`);
              } else {
                throw new Error("Must provide productKey, directKey, or pageUrl");
              }
              return await this.fetchWithCache(url, ttl);
            }
          }),

        },
        stopWhen: stepCountIs(5),
        abortSignal: options?.abortSignal
      });

      return result.toUIMessageStreamResponse();
    }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/tickets') {
      if (request.method === 'GET') {
        const customerEmail = url.searchParams.get('customer_email');
        let tickets;
        if (customerEmail) {
          tickets = await TicketModule.findRecentTickets(env, customerEmail, 50);
        } else {
          // For simplicity, return all tickets (in production, add pagination)
          const db = (env as any).DB as D1Database;
          const rows = await db.prepare('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 100').all();
          tickets = rows.results || [];
        }
        return new Response(JSON.stringify(tickets), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (url.pathname === '/api/stats') {
      if (request.method === 'GET') {
        const stats = await TicketModule.getStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const result = await routeAgentRequest(request, env);
    if (result) return result;
    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
