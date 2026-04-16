// src/lib/github.ts
// GitHub API helpers — verify repo access using the caller's token.

import { Octokit } from '@octokit/rest'

/**
 * Returns true if the token has at least read access to the given repo.
 * Used to prevent the extension from collecting data the caller cannot see.
 */
export async function verifyRepoAccess(repo: string, token: string): Promise<boolean> {
  const [owner, repoName] = repo.split('/')
  const octokit = new Octokit({ auth: token })

  try {
    await octokit.repos.get({ owner, repo: repoName })
    return true
  } catch {
    return false
  }
}
