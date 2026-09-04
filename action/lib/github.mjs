// The slice of the GitHub REST API the reviewer needs, with pagination and
// rate-limit handling. `fetchImpl` is injectable for tests.

export class GitHub {
  constructor({ token, repo, apiUrl = "https://api.github.com", fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.token = token;
    this.repo = repo;
    this.apiUrl = apiUrl;
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  async request(method, path, body, { accept = "application/vnd.github+json", attempt = 0 } = {}) {
    const res = await this.fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        accept,
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 403 || res.status === 429) && attempt < 3) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const retryAfter = res.headers.get("retry-after");
      const reset = res.headers.get("x-ratelimit-reset");
      if (retryAfter || remaining === "0") {
        let wait = retryAfter ? Number(retryAfter) * 1000 : reset ? Math.max(0, Number(reset) * 1000 - Date.now()) : 5000;
        await this.sleep(Math.min(wait, 60_000));
        return this.request(method, path, body, { accept, attempt: attempt + 1 });
      }
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return accept.includes("json") && text ? JSON.parse(text) : text;
  }

  async paginate(path) {
    const out = [];
    for (let page = 1; page < 50; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const batch = await this.request("GET", `${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  pull(number) {
    return this.request("GET", `/repos/${this.repo}/pulls/${number}`);
  }

  files(number) {
    return this.paginate(`/repos/${this.repo}/pulls/${number}/files`);
  }

  reviews(number) {
    return this.paginate(`/repos/${this.repo}/pulls/${number}/reviews`);
  }

  reviewComments(number) {
    return this.paginate(`/repos/${this.repo}/pulls/${number}/comments`);
  }

  issueComments(number) {
    return this.paginate(`/repos/${this.repo}/issues/${number}/comments`);
  }

  createReview(number, review) {
    return this.request("POST", `/repos/${this.repo}/pulls/${number}/reviews`, review);
  }

  updateReview(number, id, body) {
    return this.request("PUT", `/repos/${this.repo}/pulls/${number}/reviews/${id}`, { body });
  }

  dismissReview(number, id, message) {
    return this.request("PUT", `/repos/${this.repo}/pulls/${number}/reviews/${id}/dismissals`, { message, event: "DISMISS" });
  }

  createReviewComment(number, comment) {
    return this.request("POST", `/repos/${this.repo}/pulls/${number}/comments`, comment);
  }

  deleteReviewComment(id) {
    return this.request("DELETE", `/repos/${this.repo}/pulls/comments/${id}`);
  }

  createIssueComment(number, body) {
    return this.request("POST", `/repos/${this.repo}/issues/${number}/comments`, { body });
  }

  updateIssueComment(id, body) {
    return this.request("PATCH", `/repos/${this.repo}/issues/comments/${id}`, { body });
  }
}
