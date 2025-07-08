'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { formatDistanceToNow } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { fetchCommits, rewriteCommitWithAI } from './actions';
import { GitBranch, Wand2, Loader2, GitCommit, Copy, Check, ExternalLink } from 'lucide-react';

const formSchema = z.object({
  repoUrl: z.string().url({ message: "Please enter a valid GitHub repository URL." }).refine(
    (url) => url.startsWith('https://github.com/'),
    "URL must be a valid GitHub repository link (e.g., https://github.com/owner/repo)."
  ),
});

type Commit = Awaited<ReturnType<typeof fetchCommits>>['commits'] extends (infer U)[] ? U : never;

type RewriteData = {
  original: string;
  rewritten: string;
};

export default function Home() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string; url: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteData, setRewriteData] = useState<RewriteData | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);

  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      repoUrl: '',
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    setError(null);
    setCommits([]);
    setRepoInfo(null);

    try {
      const url = new URL(values.repoUrl);
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) {
        throw new Error('Invalid GitHub repository URL.');
      }
      const [owner, repo] = pathParts;
      const repoData = { owner, repo, url: values.repoUrl };

      const result = await fetchCommits(owner, repo);

      if (result.error) {
        throw new Error(result.error);
      }

      setCommits(result.commits || []);
      setRepoInfo(repoData);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch commits.');
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e.message || 'An unexpected error occurred.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRewriteClick = (commit: Commit) => {
    if (!repoInfo) return;
    setSelectedCommit(commit);
    setIsRewriting(true);
    
    rewriteCommitWithAI(repoInfo.owner, repoInfo.repo, commit.sha)
      .then(result => {
        if (result.error) {
          throw new Error(result.error);
        }
        setRewriteData({
          original: result.originalMessage!,
          rewritten: result.rewrittenMessage!,
        });
      })
      .catch(e => {
        toast({
          variant: 'destructive',
          title: 'AI Rewrite Failed',
          description: e.message || 'Could not rewrite commit message.',
        });
        setSelectedCommit(null);
      })
      .finally(() => {
        setIsRewriting(false);
      });
  };

  const handleCopy = () => {
    if (rewriteData?.rewritten) {
      navigator.clipboard.writeText(rewriteData.rewritten);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen p-4 md:p-8 bg-background/50">
      <header className="w-full max-w-4xl mb-8 text-center">
        <div className="flex items-center justify-center gap-4 mb-2">
          <GitBranch className="w-10 h-10 text-primary" />
          <h1 className="text-4xl md:text-5xl font-bold font-headline">GitView</h1>
        </div>
        <p className="text-lg text-muted-foreground">Visualize repository history and enhance commit messages with AI.</p>
      </header>
      
      <main className="w-full max-w-4xl">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline">Select Repository</CardTitle>
            <CardDescription>Enter a public GitHub repository URL to visualize its commit history.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-4">
                <FormField
                  control={form.control}
                  name="repoUrl"
                  render={({ field }) => (
                    <FormItem className="flex-grow">
                      <FormLabel className="sr-only">Repository URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://github.com/facebook/react" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Visualize'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {isLoading && (
          <div className="mt-8 space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <Card className="mt-8 text-center text-destructive-foreground bg-destructive/90">
            <CardContent className="p-6">
              <p>{error}</p>
            </CardContent>
          </Card>
        )}

        {commits.length > 0 && !isLoading && (
          <div className="mt-12">
            <h2 className="text-3xl font-bold text-center mb-8 font-headline">Commit History</h2>
            <div className="relative pl-6 sm:pl-8 border-l-2 border-dashed border-border">
              {commits.map((commit, index) => (
                <div key={commit.sha} className="relative mb-8">
                  <div className="absolute top-5 -left-[1.6rem] sm:-left-[2.1rem] transform">
                    <GitCommit className="w-6 h-6 sm:w-8 sm:h-8 text-primary bg-background rounded-full p-1" />
                  </div>
                  <Card className="ml-4 sm:ml-6 hover:shadow-xl transition-shadow duration-300">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={commit.author?.avatar_url} alt={commit.author?.login} />
                          <AvatarFallback>{commit.author?.login?.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <CardTitle className="text-base font-medium">{commit.commit.author.name}</CardTitle>
                          <CardDescription>
                            committed {formatDistanceToNow(new Date(commit.commit.author.date), { addSuffix: true })}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="font-medium">{commit.commit.message.split('\n')[0]}</p>
                      <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap break-words">{commit.commit.message.split('\n').slice(1).join('\n')}</p>
                    </CardContent>
                    <CardFooter className="flex justify-between items-center text-sm bg-muted/50 p-4">
                      <a href={commit.html_url} target="_blank" rel="noopener noreferrer" className="font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                        {commit.sha.substring(0, 7)} <ExternalLink className="w-3 h-3"/>
                      </a>
                      <Button variant="outline" size="sm" onClick={() => handleRewriteClick(commit)}>
                        <Wand2 className="mr-2 h-4 w-4" />
                        Rewrite with AI
                      </Button>
                    </CardFooter>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        )}

        <AlertDialog open={!!selectedCommit} onOpenChange={(open) => !open && setSelectedCommit(null)}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-headline">AI Commit Message Rewrite</AlertDialogTitle>
            </AlertDialogHeader>
            {isRewriting ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-muted-foreground">AI is thinking...</p>
              </div>
            ) : rewriteData ? (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                <div>
                  <h3 className="font-semibold mb-2">Original Message</h3>
                  <div className="p-4 rounded-md border bg-muted/50 text-sm whitespace-pre-wrap font-mono">{rewriteData.original}</div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold">AI Rewritten Message</h3>
                    <Button variant="ghost" size="sm" onClick={handleCopy}>
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      <span className="ml-2">{copied ? 'Copied!' : 'Copy'}</span>
                    </Button>
                  </div>
                  <div className="p-4 rounded-md border border-primary/50 bg-primary/5 text-sm whitespace-pre-wrap font-mono">{rewriteData.rewritten}</div>
                </div>
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setSelectedCommit(null)}>Close</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
