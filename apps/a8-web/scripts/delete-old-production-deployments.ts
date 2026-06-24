// Prunes old Cloudflare Pages *production* deployments, keeping the live
// (canonical) one plus the most recent few. Run on a schedule so the dashboard
// doesn't accumulate hundreds of stale production deployments over time.
//
// Relies only on Node built-ins + global `fetch`, so the workflow can run it
// without a `pnpm install`. Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN.
import process from "node:process";

const MAX_DEPLOYMENTS = 5;
const PROJECT_NAME = "a8-web";

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!CLOUDFLARE_ACCOUNT_ID) {
	throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
}

if (!CLOUDFLARE_API_TOKEN) {
	throw new Error("Missing CLOUDFLARE_API_TOKEN");
}

interface PagesDeployment {
	id: string;
	modified_on: string;
}

interface CfListResponse<T> {
	result: T[];
	result_info: { total_count: number };
}

interface CfProjectResponse {
	result: { canonical_deployment: { id: string } | null };
}

await run();

async function run(): Promise<void> {
	const idsToBeKept = new Set<string>();

	const canonicalId = await getProductionDeploymentId();
	if (canonicalId) {
		idsToBeKept.add(canonicalId);
	}

	const productionDeployments = await getProductionDeployments();

	productionDeployments.sort((a, b) =>
		b.modified_on.localeCompare(a.modified_on),
	);

	const deploymentIds = productionDeployments.map(
		(deployment) => deployment.id,
	);

	for (const id of deploymentIds) {
		if (idsToBeKept.size >= MAX_DEPLOYMENTS) {
			break;
		}
		idsToBeKept.add(id);
	}

	const idsToBeDeleted = deploymentIds.filter((id) => !idsToBeKept.has(id));

	if (!idsToBeDeleted.length) {
		console.warn("No deployments found");
		return;
	}

	for (const id of idsToBeDeleted) {
		console.log("Deleting deployment", id);
		await deletePagesDeployment(id);
	}
}

async function getProductionDeploymentId(): Promise<string | null> {
	const info = await callCfApi<CfProjectResponse>(
		`/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}`,
	);

	return info.result.canonical_deployment?.id ?? null;
}

async function getProductionDeployments(): Promise<PagesDeployment[]> {
	console.log("Fetching production deployments");
	const deployments: PagesDeployment[] = [];
	let page = 1;

	for (;;) {
		const deploymentsPage = await callCfApi<CfListResponse<PagesDeployment>>(
			`/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments?env=production&page=${page}`,
		);

		deployments.push(...deploymentsPage.result);

		console.log(
			"Fetched",
			deployments.length,
			"of",
			deploymentsPage.result_info.total_count,
		);

		if (deploymentsPage.result_info.total_count <= deployments.length) {
			break;
		}

		page++;
	}

	return deployments;
}

async function deletePagesDeployment(deploymentId: string): Promise<void> {
	await callCfApi(
		`/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments/${deploymentId}?env=production&force=true`,
		"DELETE",
	);
}

async function callCfApi<T = unknown>(
	path: string,
	method = "GET",
	body: unknown = null,
): Promise<T> {
	let retries = 0;
	let delay = 1000;

	for (;;) {
		try {
			const response = await fetch(
				`https://api.cloudflare.com/client/v4${path}`,
				{
					method,
					headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
					body: body ? JSON.stringify(body) : null,
				},
			);

			if (!response.ok) {
				console.error(await response.json());
				throw new Error(
					`Failed to call Cloudflare API: ${response.statusText}`,
				);
			}

			return (await response.json()) as T;
		} catch (error) {
			if (retries === 3) {
				throw error;
			}
			console.log("Retrying in", delay, "ms");
			console.error(error);
			await new Promise((resolve) => setTimeout(resolve, delay));
			retries++;
			delay *= 2;
		}
	}
}
