export class TicketModule {
  private static getDb(env: Env) {
    const db = env.DB as D1Database | undefined;
    if (!db) {
      throw new Error("D1 binding DB is not configured");
    }
    return db;
  }

  static async createTicket(
    env: Env,
    {
      customer_email,
      category,
      sentiment,
      urgency,
      transcript,
      status = "pending"
    }: {
      customer_email: string;
      category: string;
      sentiment: string;
      urgency: string;
      transcript: string;
      status?: string;
    }
  ) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await this.getDb(env)
      .prepare(
        `INSERT INTO tickets (id, customer_email, category, sentiment, urgency, status, transcript, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        customer_email,
        category,
        sentiment,
        urgency,
        status,
        transcript,
        createdAt,
        createdAt
      )
      .run();

    return {
      id,
      customer_email,
      category,
      sentiment,
      urgency,
      status,
      transcript,
      created_at: createdAt
    };
  }

  static async getTicket(env: Env, id: string) {
    const result = await this.getDb(env)
      .prepare(`SELECT * FROM tickets WHERE id = ?`)
      .bind(id)
      .first<{
        id: string;
        customer_email: string;
        category: string;
        sentiment: string;
        urgency: string;
        status: string;
        transcript: string;
        created_at: string;
        updated_at: string;
      }>();
    return result || null;
  }

  static async updateTicketStatus(env: Env, id: string, status: string) {
    const updatedAt = new Date().toISOString();
    await this.getDb(env)
      .prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, updatedAt, id)
      .run();
    return { id, status, updated_at: updatedAt };
  }

  static async appendTranscript(
    env: Env,
    id: string,
    additionalTranscript: string
  ) {
    const ticket = await this.getTicket(env, id);
    if (!ticket) return null;
    const transcript = `${ticket.transcript}\n\n${additionalTranscript}`;
    const updatedAt = new Date().toISOString();
    await this.getDb(env)
      .prepare(`UPDATE tickets SET transcript = ?, updated_at = ? WHERE id = ?`)
      .bind(transcript, updatedAt, id)
      .run();
    return { id, transcript, updated_at: updatedAt };
  }

  static async findRecentTickets(env: Env, customer_email: string, limit = 10) {
    const rows = await this.getDb(env)
      .prepare(
        `SELECT * FROM tickets WHERE customer_email = ? ORDER BY created_at DESC LIMIT ?`
      )
      .bind(customer_email, limit)
      .all<{
        id: string;
        customer_email: string;
        category: string;
        sentiment: string;
        urgency: string;
        status: string;
        transcript: string;
        created_at: string;
        updated_at: string;
      }>();
    return rows.results || [];
  }

  static async findCustomerHistory(env: Env, customer_email: string) {
    return this.findRecentTickets(env, customer_email, 20);
  }

  static async identifyCustomer(env: Env, customer_email: string) {
    const result = await this.getDb(env)
      .prepare(`SELECT COUNT(*) AS count FROM tickets WHERE customer_email = ?`)
      .bind(customer_email)
      .first<{ count: number }>();
    const count = result?.count ?? 0;
    return {
      existing: count > 0,
      pastQueries: count,
      status: count > 0 ? "existing" : "new"
    };
  }

  static async getStats(env: Env) {
    const db = this.getDb(env);
    const total = await db
      .prepare("SELECT COUNT(*) as count FROM tickets")
      .first<{ count: number }>();
    const open = await db
      .prepare("SELECT COUNT(*) as count FROM tickets WHERE status = ?")
      .bind("open")
      .first<{ count: number }>();
    const closed = await db
      .prepare("SELECT COUNT(*) as count FROM tickets WHERE status = ?")
      .bind("closed")
      .first<{ count: number }>();
    const pending = await db
      .prepare("SELECT COUNT(*) as count FROM tickets WHERE status = ?")
      .bind("pending")
      .first<{ count: number }>();
    const escalated = await db
      .prepare("SELECT COUNT(*) as count FROM tickets WHERE status = ?")
      .bind("escalated")
      .first<{ count: number }>();

    return {
      total: total?.count ?? 0,
      open: open?.count ?? 0,
      closed: closed?.count ?? 0,
      pending: pending?.count ?? 0,
      escalated: escalated?.count ?? 0
    };
  }
}
