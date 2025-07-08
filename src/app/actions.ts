'use server';

import { rewriteCommitMessage } from '@/ai/flows/rewrite-commit-message';

const GITHUB_API_BASE = 'https://api.github.com';

export async function fetchCommits(owner: string, repo: string) {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        // For unauthenticated requests, the rate limit is 60 requests per hour.
        // For higher rate limits, an auth token would be needed.
      },
      next: {
        revalidate: 3600 // Revalidate once an hour
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'Repository not found. Please check the URL.' };
      }
      if (response.status === 403) {
        return { error: 'GitHub API rate limit exceeded. Please try again later.' };
      }
      const errorData = await response.json();
      return { error: errorData.message || `Failed to fetch commits (status: ${response.status}).` };
    }

    const commits = await response.json();
    return { commits };
  } catch (error) {
    console.error('Fetch commits error:', error);
    return { error: 'An unexpected network error occurred.' };
  }
}

export async function rewriteCommitWithAI(owner: string, repo: string, sha: string) {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${sha}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
       next: {
        revalidate: 3600 * 24 // Revalidate once a day
      }
    });

    if (!response.ok) {
        const errorData = await response.json();
        return { error: errorData.message || `Failed to fetch commit details (status: ${response.status}).` };
    }

    const commitDetails = await response.json();
    const originalMessage = commitDetails.commit.message;
    const diff = commitDetails.files.map((file: any) => file.patch || '').join('\n');

    if (!diff) {
        return { error: 'Could not retrieve diff for this commit. It might be a merge commit or empty.' };
    }

    const result = await rewriteCommitMessage({
      commitMessage: originalMessage,
      diff: diff,
    });
    
    return { rewrittenMessage: result.rewrittenMessage, originalMessage };
  } catch (error: any) {
    console.error('Rewrite commit error:', error);
    if (error.message.includes('SAFETY')) {
        return { error: 'The AI model refused to generate a response due to safety concerns.' };
    }
    return { error: 'An unexpected error occurred during AI rewrite.' };
  }
}
