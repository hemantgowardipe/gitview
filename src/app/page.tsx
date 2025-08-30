'use client';

import { useEffect, useState, useTransition, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, subDays } from 'date-fns';
import { formatDistanceToNow } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { fetchCommits, rewriteCommitWithAI } from './actions';
import { GitBranch, Wand2, Loader2, GitCommit, Copy, Check, ExternalLink, BarChart2, Users, Calendar } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

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

type ContributorStats = {
  name: string;
  commits: number;
  avatar: string;
}[];

type DailyCommits = {
    date: string;
    commits: number;
}[];


export default function Home() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string; url: string } | null>(null);
  const [isFetchingCommits, startFetchingTransition] = useTransition();

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

  const chartData = useMemo(() => {
    if (commits.length === 0) return null;

    const contributorStats: { [key: string]: { commits: number; avatar: string } } = {};
    const dailyCommits: { [key: string]: number } = {};
    const last30Days = Array.from({ length: 30 }, (_, i) => {
        const d = subDays(new Date(), i);
        return format(d, 'yyyy-MM-dd');
    }).reverse();
    
    last30Days.forEach(day => dailyCommits[day] = 0);

    commits.forEach(commit => {
        const author = commit.commit.author.name;
        const authorLogin = commit.author?.login;
        const avatar = commit.author?.avatar_url;
        
        if (authorLogin && avatar) {
            if (!contributorStats[author]) {
                contributorStats[author] = { commits: 0, avatar: avatar };
            }
            contributorStats[author].commits++;
        }
        
        const commitDate = format(new Date(commit.commit.author.date), 'yyyy-MM-dd');
        if (dailyCommits[commitDate] !== undefined) {
            dailyCommits[commitDate]++;
        }
    });

    const sortedContributors: ContributorStats = Object.entries(contributorStats)
        .map(([name, { commits, avatar }]) => ({ name, commits, avatar }))
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 10);

    const formattedDailyCommits: DailyCommits = Object.entries(dailyCommits)
        .map(([date, commits]) => ({ date: format(new Date(date), 'MMM dd'), commits }))


    return {
        contributors: sortedContributors,
        daily: formattedDailyCommits,
    };
  }, [commits]);


  const handleFetchCommits = (repoUrl: string) => {
    startFetchingTransition(async () => {
      setCommits([]);
      setRepoInfo(null);
      window.history.pushState({}, '', `?repo=${encodeURIComponent(repoUrl)}`);
      
      try {
        const url = new URL(repoUrl);
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) {
          throw new Error('Invalid GitHub repository URL path.');
        }
        const owner = pathParts[0];
        const repo = pathParts[1].replace(/\.git$/, '');
        const repoData = { owner, repo, url: repoUrl };

        const result = await fetchCommits(owner, repo);

        if (result.error) {
          throw new Error(result.error);
        }

        setCommits(result.commits || []);
        setRepoInfo(repoData);
      } catch (e: any) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: e.message || 'An unexpected error occurred.',
        });
      }
    });
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    handleFetchCommits(values.repoUrl);
  };
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const repoFromQuery = params.get('repo');
    if (repoFromQuery) {
      const validation = formSchema.safeParse({ repoUrl: repoFromQuery });
      if (validation.success) {
        form.setValue('repoUrl', repoFromQuery);
        handleFetchCommits(repoFromQuery);
      } else {
        toast({
            variant: 'destructive',
            title: 'Invalid URL in query parameter',
            description: validation.error.errors[0].message
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRewriteClick = (commit: Commit) => {
    if (!repoInfo) return;
    setSelectedCommit(commit);
    setIsRewriting(true);
    setRewriteData(null);
    
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
    <div className="flex flex-col items-center min-h-screen p-4 md:p-8">
      <header className="w-full max-w-5xl mb-10 text-center relative">
         <div className="absolute -top-10 -left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl -z-10"></div>
         <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-secondary/20 rounded-full blur-3xl -z-10"></div>
        <div className="flex items-center justify-center gap-4 mb-2">
          <div className="p-3 bg-primary/10 rounded-lg">
            <GitBranch className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-headline bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            GitView
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">Visualize repository history and enhance commit messages with AI.</p>
      </header>
      
      <main className="w-full max-w-5xl">
        <Card className="shadow-lg bg-card/70 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle className="font-headline text-2xl">Select Repository</CardTitle>
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
                        <Input placeholder="e.g., https://github.com/facebook/react" {...field} className="h-12 text-base"/>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isFetchingCommits} size="lg" className="h-12 text-base font-bold">
                  {isFetchingCommits ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Visualize'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {(isFetchingCommits || chartData) && (
            <div className="mt-8">
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <Card className="bg-card/70 backdrop-blur-sm border-border/50">
                        <CardHeader>
                            <CardTitle className="font-headline text-xl flex items-center gap-2"><Calendar className="w-5 h-5 text-primary"/> Commits (Last 30 Days)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {isFetchingCommits ? <Skeleton className="h-[250px] w-full" /> : (
                                <ChartContainer config={{}} className="h-[250px] w-full">
                                    <LineChart data={chartData?.daily} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                                        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
                                        <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} allowDecimals={false}/>
                                        <Tooltip cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 2 }} content={<ChartTooltipContent indicator="line" />} />
                                        <Line type="monotone" dataKey="commits" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ChartContainer>
                            )}
                        </CardContent>
                    </Card>
                     <Card className="bg-card/70 backdrop-blur-sm border-border/50">
                        <CardHeader>
                             <CardTitle className="font-headline text-xl flex items-center gap-2"><Users className="w-5 h-5 text-primary"/> Top Contributors</CardTitle>
                        </CardHeader>
                        <CardContent>
                             {isFetchingCommits ? <Skeleton className="h-[250px] w-full" /> : (
                                 <ChartContainer config={{}} className="h-[250px] w-full">
                                    <BarChart data={chartData?.contributors} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 0 }}>
                                        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                                        <XAxis type="number" dataKey="commits" hide />
                                        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tickMargin={8} width={100} tick={{fontSize: 12}} />
                                        <Tooltip cursor={{ fill: 'hsl(var(--accent))' }} content={<ChartTooltipContent />} />
                                        <Bar dataKey="commits" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                 </ChartContainer>
                             )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        )}

        {form.formState.errors.repoUrl && !isFetchingCommits && (
           <Card className="mt-8 text-center text-destructive-foreground bg-destructive/90">
             <CardContent className="p-6">
               <p>{form.formState.errors.repoUrl.message}</p>
             </CardContent>
           </Card>
        )}

        {commits.length > 0 && !isFetchingCommits && (
          <div className="mt-12">
            <h2 className="text-3xl font-bold text-center mb-8 font-headline">Commit History</h2>
            <div className="relative pl-6 sm:pl-8 border-l-2 border-dashed border-primary/20">
              {commits.map((commit, index) => (
                <div key={commit.sha} className="relative mb-8">
                  <div className="absolute top-5 -left-[1.7rem] sm:-left-[2.2rem] transform">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 bg-background flex items-center justify-center rounded-full">
                        <GitCommit className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                    </div>
                  </div>
                  <Card className="ml-4 sm:ml-6 hover:shadow-2xl hover:border-primary/50 transition-all duration-300 bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-4">
                      <div className="flex justify-between items-start">
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
                        <a href={commit.html_url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 pt-1">
                          {commit.sha.substring(0, 7)} <ExternalLink className="w-3 h-3"/>
                        </a>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="font-medium text-lg text-foreground/90">{commit.commit.message.split('\n')[0]}</p>
                      {commit.commit.message.split('\n').slice(1).join('\n').trim() && (
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap break-words font-mono border-l-2 border-border/50 pl-4 py-2 bg-black/10 rounded-r-md">
                          {commit.commit.message.split('\n').slice(1).join('\n')}
                        </p>
                      )}
                    </CardContent>
                    <CardFooter className="flex justify-end items-center text-sm p-4">
                      <Button variant="outline" size="sm" onClick={() => handleRewriteClick(commit)} disabled={isRewriting && selectedCommit?.sha === commit.sha}>
                         {isRewriting && selectedCommit?.sha === commit.sha ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
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
          <AlertDialogContent className="max-w-2xl bg-background/80 backdrop-blur-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-headline text-2xl flex items-center gap-3">
                <Wand2 className="text-primary"/> AI Commit Message Rewrite
              </AlertDialogTitle>
              <AlertDialogDescription>
                The AI has analyzed the commit changes and suggested a more descriptive message.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {isRewriting ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-muted-foreground">AI is analyzing the diff...</p>
              </div>
            ) : rewriteData ? (
              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 -mr-2">
                <div>
                  <h3 className="font-semibold mb-2 text-muted-foreground">Original Message</h3>
                  <div className="p-4 rounded-md border bg-muted/30 text-sm whitespace-pre-wrap font-mono">{rewriteData.original}</div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-primary">AI Rewritten Message</h3>
                    <Button variant="ghost" size="sm" onClick={handleCopy}>
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      <span className="ml-2">{copied ? 'Copied!' : 'Copy'}</span>
                    </Button>
                  </div>
                  <div className="p-4 rounded-md border border-primary/50 bg-primary/10 text-sm whitespace-pre-wrap font-mono">{rewriteData.rewritten}</div>
                </div>
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setSelectedCommit(null);
                setRewriteData(null);
              }}>Close</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
