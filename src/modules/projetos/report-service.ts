/**
 * @file report-service.ts
 * @module modules/projetos
 *
 * Geração do relatório executivo de um projeto em PDF (PDFKit) e agregados do
 * dashboard de projetos (para o superadmin). O PDF reúne dados do projeto,
 * membros, tarefas por coluna, tempo apontado e custos.
 */

import type { PoolClient } from "pg";
import PDFDocument from "pdfkit";
import { getProject, getProjectTotals } from "./project-service.js";
import { listTasksByProject } from "./task-service.js";

/** Formata minutos como "Xh Ymin". */
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}min`;
}

/** Formata um valor como moeda BRL. */
function brl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

const STATUS_LABELS: Record<string, string> = {
  nao_iniciada: "Não iniciadas",
  em_execucao: "Em execução",
  finalizada: "Finalizadas",
};

/**
 * Gera o relatório executivo do projeto em PDF.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param viewerUserId - Usuário solicitante (para visibilidade das tarefas).
 * @returns Um Buffer com o PDF.
 */
export async function generateProjectReport(
  client: PoolClient,
  projectId: string,
  viewerUserId: string,
): Promise<Buffer> {
  const project = await getProject(client, projectId, viewerUserId);
  const totals = await getProjectTotals(client, projectId);
  const tasks = await listTasksByProject(client, projectId, viewerUserId);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // Cabeçalho.
  doc.fontSize(20).text("Relatório Executivo de Projeto", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(16).fillColor("#333").text(project.name);
  doc.fillColor("#000").fontSize(10).text(`Status: ${project.status === "ativo" ? "Ativo" : "Arquivado"}`);
  if (project.due_date) doc.text(`Prazo do projeto: ${project.due_date}`);
  doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
  doc.moveDown(0.8);

  if (project.description) {
    doc.fontSize(12).text("Descrição", { underline: true });
    doc.fontSize(10).text(project.description);
    doc.moveDown(0.5);
  }
  if (project.detail) {
    doc.fontSize(12).text("Descritivo", { underline: true });
    doc.fontSize(10).text(project.detail);
    doc.moveDown(0.5);
  }

  // Indicadores.
  doc.fontSize(12).text("Indicadores", { underline: true });
  doc.fontSize(10);
  doc.text(`Tempo total apontado: ${fmtMinutes(totals.total_minutes)}`);
  doc.text(`Valor/hora do projeto: ${brl(Number(project.hourly_rate))}`);
  doc.text(`Custo de mão de obra (estimado): ${brl(totals.labor_cost)}`);
  doc.text(`Custo de recursos: ${brl(totals.resource_cost)}`);
  doc.text(`Custo total estimado: ${brl(totals.total_cost)}`);
  doc.moveDown(0.6);

  // Membros.
  doc.fontSize(12).text("Equipe", { underline: true });
  doc.fontSize(10);
  for (const m of project.members) {
    const owner = m.user_id === project.owner_user_id ? " (Dono)" : "";
    doc.text(`• ${m.full_name ?? m.email}${owner}`);
  }
  doc.moveDown(0.6);

  // Tarefas por coluna.
  doc.fontSize(12).text("Tarefas", { underline: true });
  doc.fontSize(10);
  for (const status of ["nao_iniciada", "em_execucao", "finalizada"] as const) {
    const group = tasks.filter((t) => t.status === status);
    doc.moveDown(0.2);
    doc.fillColor("#1565c0").text(`${STATUS_LABELS[status]} (${group.length})`);
    doc.fillColor("#000");
    for (const t of group) {
      const due = t.due_date ? ` — prazo ${t.due_date}` : "";
      const time = t.minutes_total > 0 ? ` — ${fmtMinutes(t.minutes_total)}` : "";
      doc.text(`   • ${t.title}${due}${time}`);
    }
    if (group.length === 0) doc.fillColor("#888").text("   (nenhuma)").fillColor("#000");
  }

  // Recursos e custos.
  if (project.resources.length > 0) {
    doc.moveDown(0.6);
    doc.fontSize(12).text("Recursos e custos", { underline: true });
    doc.fontSize(10);
    for (const r of project.resources) {
      doc.text(`• ${r.description}: ${brl(Number(r.cost))}`);
    }
  }

  doc.end();
  return done;
}

/** Uma linha do dashboard por projeto. */
export interface DashboardRow {
  project_id: string;
  name: string;
  status: "ativo" | "arquivado";
  task_count: number;
  done_count: number;
  total_minutes: number;
  labor_cost: number;
  resource_cost: number;
  total_cost: number;
}

/** Agregado geral do dashboard. */
export interface DashboardSummary {
  projects: DashboardRow[];
  totals: {
    project_count: number;
    total_minutes: number;
    total_cost: number;
  };
}

/**
 * Agrega quantitativos, horas e custos de todos os projetos (para o superadmin).
 *
 * @param client - Cliente PostgreSQL.
 * @returns Linhas por projeto e totais gerais.
 */
export async function projectsDashboard(client: PoolClient): Promise<DashboardSummary> {
  const { rows } = await client.query<{
    project_id: string;
    name: string;
    status: "ativo" | "arquivado";
    hourly_rate: string;
    task_count: string;
    done_count: string;
    total_minutes: string;
    resource_cost: string;
  }>(
    `SELECT p.id AS project_id, p.name, p.status, p.hourly_rate,
            (SELECT COUNT(*) FROM mod_projetos.tasks t WHERE t.project_id = p.id)::text AS task_count,
            (SELECT COUNT(*) FROM mod_projetos.tasks t WHERE t.project_id = p.id AND t.status = 'finalizada')::text AS done_count,
            COALESCE((SELECT SUM(tc.minutes) FROM mod_projetos.task_comments tc
                      JOIN mod_projetos.tasks t ON t.id = tc.task_id
                      WHERE t.project_id = p.id), 0)::text AS total_minutes,
            COALESCE((SELECT SUM(r.cost) FROM mod_projetos.project_resources r WHERE r.project_id = p.id), 0)::text AS resource_cost
     FROM mod_projetos.projects p
     ORDER BY p.created_at DESC`,
  );

  const projects: DashboardRow[] = rows.map((r) => {
    const minutes = Number(r.total_minutes);
    const laborCost = Math.round((minutes / 60) * Number(r.hourly_rate) * 100) / 100;
    const resourceCost = Math.round(Number(r.resource_cost) * 100) / 100;
    return {
      project_id: r.project_id,
      name: r.name,
      status: r.status,
      task_count: Number(r.task_count),
      done_count: Number(r.done_count),
      total_minutes: minutes,
      labor_cost: laborCost,
      resource_cost: resourceCost,
      total_cost: Math.round((laborCost + resourceCost) * 100) / 100,
    };
  });

  return {
    projects,
    totals: {
      project_count: projects.length,
      total_minutes: projects.reduce((s, p) => s + p.total_minutes, 0),
      total_cost: Math.round(projects.reduce((s, p) => s + p.total_cost, 0) * 100) / 100,
    },
  };
}
